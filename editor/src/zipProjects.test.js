import { File as DiskFile } from 'node:buffer';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archivePath, zipProjectSource } from './zipProjects.js';

let writeFailure;
function directory(name = '') {
  const children = new Map();
  const handle = {
    name, kind: 'directory', children,
    async *entries() { yield* children; },
    getDirectoryHandle: vi.fn(async (name, { create = false } = {}) => {
      if (!children.has(name) && create) children.set(name, directory(name));
      const entry = children.get(name);
      if (!entry) throw new DOMException('Missing directory', 'NotFoundError');
      if (entry.kind !== 'directory') throw new DOMException('Expected directory', 'TypeMismatchError');
      return entry;
    }),
    getFileHandle: vi.fn(async (name, { create = false } = {}) => {
      if (!children.has(name) && create) {
        let data = new DiskFile([], name);
        children.set(name, {
          name, kind: 'file', getFile: async () => data,
          createWritable: async () => {
            const chunks = [];
            return new WritableStream({
              write: chunk => { if (writeFailure) throw writeFailure; chunks.push(chunk); },
              close: () => { data = new DiskFile(chunks, name); },
            });
          },
        });
      }
      const entry = children.get(name);
      if (!entry) throw new DOMException('Missing file', 'NotFoundError');
      if (entry.kind !== 'file') throw new DOMException('Expected file', 'TypeMismatchError');
      return entry;
    }),
    removeEntry: vi.fn(async name => {
      if (!children.delete(name)) throw new DOMException('Missing entry', 'NotFoundError');
    }),
  };
  return handle;
}

async function zip(entries, options = {}) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false, level: 0 });
  for (const [name, text] of entries) await writer.add(name, new Uint8ArrayReader(new TextEncoder().encode(text)), options);
  return new DiskFile([await writer.close()], 'demo.zip');
}

let root, sources, held;
beforeEach(() => {
  root = directory();
  sources = [];
  held = new Set();
  writeFailure = null;
  vi.stubGlobal('navigator', {
    storage: { getDirectory: vi.fn(async () => root), estimate: vi.fn(async () => ({ quota: 1e9, usage: 0 })) },
    locks: { request: vi.fn(async (name, options, callback) => {
      if (typeof options === 'function') { callback = options; options = {}; }
      if (held.has(name)) {
        if (options.ifAvailable) return callback(null);
        throw new Error('Unexpected competing lock');
      }
      held.add(name);
      try { return await callback({ name }); }
      finally { held.delete(name); }
    }) },
  });
});
afterEach(async () => {
  await Promise.all(sources.map(source => source.dispose()));
  vi.unstubAllGlobals();
});
async function open(input, options) {
  const source = await zipProjectSource(input, options);
  sources.push(source);
  return source;
}
const cached = () => root.children.get('video-project-zips')?.children.size ?? 0;

describe('disk-backed ZIP projects', () => {
  it.each(['../escape.mp4', 'media/../escape.mp4', '/absolute.mp4', 'C:/file.mp4', 'media\\file.mp4',
    'media/\0bad.mp4', './', './https://host/file'])('rejects unsafe entry paths: %j', path => {
    expect(() => archivePath(path)).toThrow();
  });
  it('normalizes ordinary entry paths without losing spaces or Unicode', () => {
    expect(archivePath('./media//d\u00e9mo clip.mp4')).toBe('media/d\u00e9mo clip.mp4');
  });
  it('accepts a harmless archive-root directory marker', async () => {
    const source = await open(await zip([['./', ''], ['project.json', '{}']]));
    expect((await source.projects()).map(project => project.name)).toEqual(['project.json']);
  });
  it('extracts compressed entries to storage and scopes media to the chosen JSON directory', async () => {
    const file = await zip([
      ['bundle/project.json', '{"media_folder":"media"}'],
      ['bundle/media/d\u00e9mo.mp4', 'video bytes'],
      ['shared/other.mp4', 'shared video'],
      ['__MACOSX/._project.json', 'metadata'],
    ], { level: 6 });
    const progress = vi.fn();
    const source = await open(file, { onProgress: progress });
    const [project] = await source.projects();
    expect(project.name).toBe('bundle/project.json');
    expect(project.handle).toBe(null);
    expect(source.directory).toBe(null);
    expect(await (await project.getFile()).text()).toBe('{"media_folder":"media"}');
    expect(await (await project.source.media('media/d\u00e9mo.mp4')).text()).toBe('video bytes');
    expect(await (await project.source.media('../shared/other.mp4')).text()).toBe('shared video');
    await expect(project.source.media('../../outside.mp4')).rejects.toThrow('outside');
    await expect(project.source.media('missing.mp4')).rejects.toThrow('not found');
    expect(progress.mock.calls.at(-1)[0]).toMatchObject({ phase: 'Extracting ZIP', bytes: expect.any(Number) });
    expect(cached()).toBe(1);
    await source.dispose();
    expect(cached()).toBe(0);
  });
  it('lists multiple project JSON files and resolves each project independently', async () => {
    const source = await open(await zip([
      ['b/project.json', '{}'], ['a/project.json', '{}'], ['a/demo.mp4', 'A'], ['b/demo.mp4', 'B'],
    ]));
    const projects = await source.projects();
    expect(projects.map(project => project.name)).toEqual(['a/project.json', 'b/project.json']);
    expect(await (await projects[0].source.media('demo.mp4')).text()).toBe('A');
    expect(await (await projects[1].source.media('demo.mp4')).text()).toBe('B');
  });
  it('streams URL downloads to disk, removes the temporary ZIP and reports progress', async () => {
    const file = await zip([['project.json', '{}'], ['media/demo.mp4', 'video']]);
    const response = new Response(file.stream(), { headers: { 'content-length': `${file.size}`, 'content-type': 'application/zip' } });
    response.blob = vi.fn(() => { throw new Error('Must not buffer download'); });
    response.arrayBuffer = vi.fn(() => { throw new Error('Must not buffer download'); });
    const fetch = vi.fn(async () => response);
    vi.stubGlobal('fetch', fetch);
    const progress = vi.fn(), controller = new AbortController();
    const source = await open('https://files.example/demo.zip', { signal: controller.signal, onProgress: progress });
    expect(fetch).toHaveBeenCalledWith('https://files.example/demo.zip', { signal: controller.signal, credentials: 'omit' });
    expect(progress.mock.calls.some(([value]) => value.phase === 'Downloading ZIP' && value.bytes === file.size)).toBe(true);
    expect(response.blob).not.toHaveBeenCalled();
    expect(response.arrayBuffer).not.toHaveBeenCalled();
    const cache = [...root.children.get('video-project-zips').children.values()][0];
    expect(cache.children.has('download.zip')).toBe(false);
    expect(await (await (await source.projects())[0].source.media('media/demo.mp4')).text()).toBe('video');
  });
  it('cleans stale caches without deleting projects still owned by another tab', async () => {
    const cache = await root.getDirectoryHandle('video-project-zips', { create: true });
    await cache.getDirectoryHandle('orphan', { create: true });
    const file = await zip([['project.json', '{}']]);
    const first = await open(file);
    expect(cache.children.has('orphan')).toBe(false);
    const second = await open(file);
    expect(cached()).toBe(2);
    expect(held.size).toBe(2);
    await first.dispose();
    expect(cached()).toBe(1);
    expect(await (await (await second.projects())[0].getFile()).text()).toBe('{}');
  });
  it.each([
    [['project.json', '{}'], ['../escape.mp4', 'bad']],
    [['project.json', '{}'], ['demo.mp4', 'one'], ['./demo.mp4', 'two']],
    [['video.mp4', 'no JSON']],
  ])('rejects invalid archive contents and cleans their cache: %j', async entries => {
    await expect(open(await zip(entries))).rejects.toThrow();
    expect(cached()).toBe(0);
    expect(held.size).toBe(0);
  });
  it('rejects invalid and truncated ZIPs without leaving storage behind', async () => {
    const valid = await zip([['project.json', '{}']]);
    for (const file of [new DiskFile(['not a ZIP'], 'bad.zip'), valid.slice(0, valid.size - 22)]) {
      await expect(open(file)).rejects.toThrow();
      expect(cached()).toBe(0);
    }
  });
  it('reports insufficient browser quota and removes partial cache files', async () => {
    navigator.storage.estimate.mockResolvedValue({ quota: 1, usage: 0 });
    await expect(open(await zip([['project.json', '{}']]))).rejects.toThrow('Not enough browser storage');
    expect(cached()).toBe(0);
  });
  it('cleans up and reports quota failures during actual extraction writes', async () => {
    writeFailure = new DOMException('Disk quota exceeded', 'QuotaExceededError');
    await expect(open(await zip([['project.json', '{}']]))).rejects.toThrow('Not enough browser storage');
    expect(cached()).toBe(0);
    expect(held.size).toBe(0);
  });
  it('rejects corrupted content instead of accepting files with a bad checksum', async () => {
    const text = '{"title":"CRC verification"}', payload = new TextEncoder().encode(text);
    const data = new Uint8Array(await (await zip([['project.json', text]])).arrayBuffer());
    const offset = data.findIndex((value, index) => value === payload[0] && payload.every((byte, part) => data[index + part] === byte));
    expect(offset).toBeGreaterThan(0);
    data[offset] ^= 1;
    await expect(open(new DiskFile([data], 'corrupt.zip'))).rejects.toThrow(/CRC|signature/i);
    expect(cached()).toBe(0);
  });
  it('rejects password-protected archives with an explicit error', async () => {
    const file = await zip([['project.json', '{}']], { password: 'test', zipCrypto: true });
    await expect(open(file)).rejects.toThrow('Password-protected ZIP');
    expect(cached()).toBe(0);
  });
  it('aborts extraction and clears all partially written files', async () => {
    const controller = new AbortController();
    const file = await zip([['project.json', '{"title":"demo"}'], ['video.mp4', 'bytes'.repeat(1000)]]);
    await expect(open(file, {
      signal: controller.signal,
      onProgress: progress => { if (progress.phase === 'Extracting ZIP' && progress.bytes) controller.abort(); },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(cached()).toBe(0);
    expect(held.size).toBe(0);
  });
  it('aborts a streamed download and clears its temporary file', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      pull(stream) { stream.enqueue(new Uint8Array(100)); },
    }))));
    await expect(open('https://files.example/demo.zip', {
      signal: controller.signal, onProgress: progress => { if (progress.bytes) controller.abort(); },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(cached()).toBe(0);
  });
  it.each([
    ['HTTP failure', async () => new Response('missing', { status: 404 }), 'HTTP 404'],
    ['sharing page', async () => new Response('<html>Drive</html>', { headers: { 'content-type': 'text/html' } }), 'web page'],
    ['network failure', async () => { throw new TypeError('Failed to fetch'); }, 'CORS'],
  ])('surfaces %s and removes download caches', async (_, fetch, message) => {
    vi.stubGlobal('fetch', vi.fn(fetch));
    await expect(open('https://files.example/demo.zip')).rejects.toThrow(message);
    expect(cached()).toBe(0);
  });
  it.each(['not a URL', 'file:///tmp/demo.zip', 'https://user:password@files.example/demo.zip'])(
    'rejects invalid or credential-bearing URLs: %s', async url => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      await expect(open(url)).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
      expect(cached()).toBe(0);
    });
  it('requires browser-backed storage rather than silently falling back to memory', async () => {
    navigator.storage.getDirectory = undefined;
    await expect(open(await zip([['project.json', '{}']]))).rejects.toThrow('browser-backed storage');
  });
});
