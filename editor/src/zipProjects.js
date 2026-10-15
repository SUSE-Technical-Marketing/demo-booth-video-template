import { mediaPathValid } from './project.js';
import { projectMediaPath } from './projectFiles.js';

const CACHE = 'video-project-zips';
const lockName = id => `${CACHE}:${id}`;

export function archivePath(name) {
  if (!mediaPathValid(name) || name.split('/').includes('..')) {
    throw new Error(`Unsafe ZIP entry: ${name}`);
  }
  const path = name.split('/').filter(part => part && part !== '.').join('/');
  if (!path || !mediaPathValid(path)) throw new Error(`Invalid ZIP entry: ${name}`);
  return path;
}

async function createCache() {
  if (!navigator.storage?.getDirectory || !navigator.locks?.request) {
    throw new Error('ZIP imports need browser-backed storage (OPFS) and Web Locks. Use a recent browser over HTTPS or localhost.');
  }
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(CACHE, { create: true });
  for await (const [id, entry] of root.entries()) {
    if (entry.kind !== 'directory') continue;
    await navigator.locks.request(lockName(id), { ifAvailable: true }, async lock => {
      if (lock) {
        try { await root.removeEntry(id, { recursive: true }); }
        catch (error) { if (error.name !== 'NotFoundError') throw error; }
      }
    });
  }
  const id = crypto.randomUUID();
  let release, ready, failed;
  const acquired = new Promise((resolve, reject) => { ready = resolve; failed = reject; });
  const held = navigator.locks.request(lockName(id), () => new Promise(resolve => {
    release = resolve;
    ready();
  }));
  held.catch(failed);
  await acquired;
  let directory;
  try { directory = await root.getDirectoryHandle(id, { create: true }); }
  catch (error) { release(); await held; throw error; }
  let disposal;
  return {
    directory,
    dispose() {
      return disposal ??= (async () => {
        try { await root.removeEntry(id, { recursive: true }); }
        finally { release(); await held; }
      })();
    },
  };
}

async function createFile(directory, path) {
  const parts = path.split('/');
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true });
  return directory.getFileHandle(parts.at(-1), { create: true });
}

async function downloadZip(value, directory, signal, progress) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error('Enter an absolute HTTP or HTTPS ZIP URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use an HTTP or HTTPS ZIP URL without embedded login credentials');
  }
  progress({ phase: 'Downloading ZIP', bytes: 0 });
  let response;
  try { response = await fetch(url.href, { signal, credentials: 'omit' }); }
  catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('Could not download ZIP. Check the URL, network connection and the host CORS permissions.', { cause: error });
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`ZIP download failed (HTTP ${response.status})`);
  }
  if (response.headers.get('content-type')?.includes('text/html')) {
    await response.body.cancel();
    throw new Error('The URL returned a web page, not a ZIP. Use a direct download link; Drive sharing pages are not supported.');
  }
  const length = Number(response.headers.get('content-length'));
  const total = Number.isSafeInteger(length) && length > 0 ? length : undefined;
  const handle = await directory.getFileHandle('download.zip', { create: true });
  let writable;
  try { writable = await handle.createWritable(); }
  catch (error) { await response.body.cancel(error); throw error; }
  let bytes = 0;
  await response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      progress({ phase: 'Downloading ZIP', bytes, total });
      controller.enqueue(chunk);
    },
  })).pipeTo(writable, { signal });
  return handle.getFile();
}

function projectSource(files, dispose, signal) {
  const media = async (path, base = '') => {
    signal?.throwIfAborted();
    if (!mediaPathValid(path)) throw new Error('Expected a relative media path');
    const fullPath = projectMediaPath(base ? `${base}/${path}` : path);
    const handle = files.get(fullPath);
    if (!handle) throw new Error(`File was not found in the ZIP: ${fullPath}`);
    return handle.getFile();
  };
  return {
    directory: null, dispose, signal,
    async projects() {
      return [...files.keys()].filter(path => /\.json$/i.test(path)).sort().map(path => ({
        name: path, handle: null, getFile: () => media(path),
        source: {
          directory: null, dispose, signal,
          media: name => media(name, path.split('/').slice(0, -1).join('/')),
        },
      }));
    },
  };
}

export async function zipProjectSource(input, { signal, onProgress = () => {} } = {}) {
  signal?.throwIfAborted();
  const cache = await createCache();
  try {
    const remote = typeof input === 'string';
    const file = remote ? await downloadZip(input, cache.directory, signal, onProgress) : input;
    signal?.throwIfAborted();
    const { BlobReader, ZipReader } = await import('@zip.js/zip.js');
    const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false, checkSignature: true });
    const files = new Map();
    try {
      const entries = await reader.getEntries();
      const paths = new Set(), selected = [];
      for (const entry of entries) {
        signal?.throwIfAborted();
        if (entry.directory && ['.', './'].includes(entry.filename)) continue;
        const path = archivePath(entry.filename);
        if (entry.directory || path.split('/').some(part => part === '__MACOSX' || part.startsWith('._'))) continue;
        if (paths.has(path)) throw new Error(`Duplicate ZIP entry: ${path}`);
        if (entry.encrypted) throw new Error('Password-protected ZIP files are not supported');
        paths.add(path);
        selected.push({ entry, path });
      }
      if (!selected.some(({ path }) => /\.json$/i.test(path))) throw new Error('No project JSON found in the ZIP');
      const total = selected.reduce((sum, { entry }) => sum + entry.uncompressedSize, 0);
      if (navigator.storage.estimate) {
        const { quota, usage } = await navigator.storage.estimate();
        if (Number.isFinite(quota) && Number.isFinite(usage) && total > quota - usage) {
          throw new DOMException('Not enough browser storage for the extracted ZIP', 'QuotaExceededError');
        }
      }
      const directory = await cache.directory.getDirectoryHandle('files', { create: true });
      let bytes = 0;
      for (const { entry, path } of selected) {
        signal?.throwIfAborted();
        const handle = await createFile(directory, path);
        const writer = (await handle.createWritable()).getWriter();
        let storageError;
        const writable = new WritableStream({
          async write(chunk) {
            try { await writer.write(chunk); }
            catch (error) { storageError = error; throw error; }
          },
        });
        try {
          await entry.getData(writable, {
            signal, checkSignature: true,
            onprogress(loaded) { onProgress({ phase: 'Extracting ZIP', bytes: bytes + loaded, total, file: path }); },
          });
          await writer.close();
        } catch (failure) {
          // Preserve disk errors if the decoder's stream cleanup replaces them.
          const error = storageError ?? failure;
          try { await writer.abort(error); }
          catch (abortError) {
            if (abortError !== error) throw new AggregateError([error, abortError], `Could not abort extraction of ${path}`);
          }
          throw error;
        } finally { writer.releaseLock(); }
        files.set(path, handle);
        bytes += entry.uncompressedSize;
        onProgress({ phase: 'Extracting ZIP', bytes, total, file: path });
      }
    } finally { await reader.close(); }
    signal?.throwIfAborted();
    if (remote) await cache.directory.removeEntry('download.zip');
    return projectSource(files, () => cache.dispose(), signal);
  } catch (error) {
    try { await cache.dispose(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'ZIP import failed and its browser cache could not be removed'); }
    if (error.name === 'QuotaExceededError') {
      throw new Error('Not enough browser storage for this ZIP. Free disk/site storage or use a smaller archive.', { cause: error });
    }
    throw error;
  }
}
