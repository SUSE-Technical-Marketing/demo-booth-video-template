import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadUrl, saveVideo, formatBytes, formatEta, getInfo, runExport, sizeHint, slowdown } from './exporter.js';

describe('helpers', () => {
  it('estimates how much slower than 1080p Standard an export is', () => {
    expect(slowdown('1920x1080', 'standard')).toBe(1);
    expect(slowdown('3840x2160', 'standard')).toBe(4);
    expect(slowdown('1280x720', 'standard')).toBeCloseTo(0.444, 2);
    expect(slowdown('3840x2160', 'high')).toBeGreaterThan(slowdown('3840x2160', 'draft'));
  });
  it('is honest that sizes above 1080p are upscaled from the layout', () => {
    expect(sizeHint('1920x1080')).toContain('exactly');
    expect(sizeHint('3840x2160')).toContain('Upscaled');
    expect(sizeHint('1280x720')).toContain('Small');
  });
  it('formats time left and sizes', () => {
    expect(formatEta(42)).toBe('42s left');
    expect(formatEta(125)).toBe('2m 5s left');
    expect(formatEta(7500)).toBe('2h 5m left');
    expect(formatEta(null)).toBe('');
    expect(formatBytes(52_000_000)).toBe('52 MB');
    expect(formatBytes(2_500_000_000)).toBe('2.5 GB');
  });
  it('builds a download link with the job token', () => {
    expect(downloadUrl('abc', 'x y')).toBe('/api/jobs/abc/download?token=x%20y');
  });
});

describe('saving the video', () => {
  afterEach(() => vi.unstubAllGlobals());
  const done = { job: 'j', token: 't' };
  it('writes to the location chosen up front without asking again', async () => {
    const written = [];
    const target = { name: 'chosen.mp4', createWritable: async () => ({ id: 1 }) };
    vi.stubGlobal('window', { showSaveFilePicker: vi.fn() });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: { pipeTo: async w => written.push(w) } })));
    const out = await saveVideo(done, 'x.mp4', { target });
    expect(window.showSaveFilePicker).not.toHaveBeenCalled();
    expect(written).toEqual([{ id: 1 }]);
    expect(out).toEqual({ name: 'chosen.mp4', where: 'the location you chose' });
  });
  it('opens the picker in the project folder when no location was chosen', async () => {
    const startIn = { kind: 'directory', name: 'proj' };
    const handle = { name: 'out.mp4', createWritable: async () => ({}) };
    vi.stubGlobal('window', { showSaveFilePicker: vi.fn(async () => handle) });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: { pipeTo: async () => {} } })));
    await saveVideo(done, 'x.mp4', { startIn });
    expect(window.showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'x.mp4', startIn }));
  });
  it('ignores a startIn that is not a file-system handle, and retries without one if the picker rejects it', async () => {
    const handle = { name: 'out.mp4', createWritable: async () => ({}) };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: { pipeTo: async () => {} } })));
    vi.stubGlobal('window', { showSaveFilePicker: vi.fn(async () => handle) });
    await saveVideo(done, 'x.mp4', { startIn: { directory: null, projects() {} } });      // a wrapper, not a handle
    expect(window.showSaveFilePicker.mock.calls[0][0]).not.toHaveProperty('startIn');
    const picker = vi.fn(async options => {
      if (options.startIn) throw new TypeError("not a valid enum value of type WellKnownDirectory");
      return handle;
    });
    vi.stubGlobal('window', { showSaveFilePicker: picker });
    await saveVideo(done, 'x.mp4', { startIn: { kind: 'directory', name: 'proj' } });
    expect(picker).toHaveBeenCalledTimes(2);
    expect(picker.mock.calls[1][0]).not.toHaveProperty('startIn');
  });
  it('falls back to a download and says where it goes', async () => {
    vi.stubGlobal('window', {});
    const click = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({ click });
    const out = await saveVideo(done, 'x.mp4');
    expect(click).toHaveBeenCalled();
    expect(out.where).toContain('download folder');
  });
});

describe('service calls', () => {
  const calls = [];
  const reply = (body, ok = true, status = 200) => Promise.resolve({ ok, status, json: async () => body });
  beforeEach(() => {
    calls.length = 0;
    class FakeXHR {
      constructor() { this.upload = {}; }
      open(method, url) { this.method = method; this.url = url; }
      setRequestHeader(name, value) { this.header = [name, value]; }
      send(body) {
        calls.push(['upload', this.method, this.url, this.header, body.size]);
        this.upload.onprogress({ lengthComputable: true, loaded: body.size });
        this.status = 200; this.onload();
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('getInfo is null when nothing answers or the service says no', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('refused')));
    expect(await getInfo()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(() => reply({}, false, 404)));
    expect(await getInfo()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(() => reply({ ok: true, encoders: {} })));
    expect((await getInfo()).ok).toBe(true);
  });

  it.each([[undefined, true], [false, false]])('creates an export with audio=%j, uploads and waits for done', async (audio, expectedAudio) => {
    const polls = [{ status: 'rendering', progress: 0.05, message: 'Preparing clips' },
      { status: 'rendering', progress: 0.5, message: 'Rendering', fps: 20, eta: 30 },
      { status: 'done', progress: 1, filename: 'x.mp4', size: 10 }];
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
      calls.push([options.method || 'GET', url, options.headers?.['X-Booth-Export']]);
      if (url === '/api/jobs') return reply({ id: 'j1', token: 'tok', media: ['ma', 'mb'], names: ['a.mp4', 'b.mp4'] }, true, 201);
      if (url === '/api/jobs/j1/start') return reply({});
      if (url === '/api/jobs/j1') return reply(polls.shift());
      return reply({});
    }));
    vi.useFakeTimers();
    const updates = [];
    const files = new Map([['ma', new File(['aaaa'], 'a.mp4')], ['mb', new File(['bb'], 'b.mp4')], ['unused', new File(['zzzz'], 'z.mp4')]]);
    const promise = runExport({ project: '{"project_version":1}', size: '3840x2160', quality: 'high', fast: false, audio, filename: 'x',
      files, onUpdate: u => updates.push(u) });
    await vi.advanceTimersByTimeAsync(2000);
    const out = await promise;
    vi.useRealTimers();
    expect(out).toMatchObject({ job: 'j1', token: 'tok', view: { status: 'done' } });
    const create = fetch.mock.calls[0];
    expect(JSON.parse(create[1].body)).toEqual({ project: { project_version: 1 }, size: '3840x2160', quality: 'high', fast: false, audio: expectedAudio, filename: 'x' });
    expect(calls.filter(c => c[0] === 'upload').map(c => [c[2], c[3], c[4]])).toEqual([
      ['/api/jobs/j1/media/0', ['X-Booth-Export', '1'], 4], ['/api/jobs/j1/media/1', ['X-Booth-Export', '1'], 2]]);   // only the used media, by slot
    expect(calls.filter(c => c[0] !== 'upload').every(c => c[2] === '1')).toBe(true);
    expect(updates.find(u => u.phase === 'uploading' && u.message.includes('2 of 2'))).toBeTruthy();
    expect(updates.at(-1)).toMatchObject({ phase: 'rendering', fraction: 0.5, fps: 20, eta: 30 });
  });

  it('refuses to start when a video the project uses is not linked, and cleans the job up', async () => {
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => url === '/api/jobs' && options.method === 'POST'
      ? reply({ id: 'j3', token: 't', media: ['ma'], names: ['a.mp4'] }, true, 201) : reply({})));
    await expect(runExport({ project: '{}', size: '1920x1080', quality: 'standard', filename: 'x', onUpdate() {},
      files: new Map() })).rejects.toThrow('a.mp4 is not linked');
    expect(fetch.mock.calls.some(([url, o]) => url === '/api/jobs/j3' && o?.method === 'DELETE')).toBe(true);
  });

  it('turns a service error into an Error and cleans the job up', async () => {
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
      if (url === '/api/jobs' && options.method === 'POST') return reply({ id: 'j2', token: 't', media: ['ma'], names: ['a.mp4'] }, true, 201);
      if (url === '/api/jobs/j2/start') return reply({ error: 'videos not uploaded yet' }, false, 409);
      return reply({});
    }));
    await expect(runExport({ project: '{}', size: '1920x1080', quality: 'standard', filename: 'x', onUpdate() {},
      files: new Map([['ma', new File(['a'], 'a.mp4')]]) })).rejects.toThrow('videos not uploaded yet');
    expect(fetch.mock.calls.some(([url, o]) => url === '/api/jobs/j2' && o?.method === 'DELETE')).toBe(true);
  });
});
