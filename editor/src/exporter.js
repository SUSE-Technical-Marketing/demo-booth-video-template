// Client for the local export service (render/server.py), reached through the dev server's /api proxy.
// The service only exists next to a locally running editor; on the hosted copy getInfo() returns null.
import { toRaw } from 'vue';

const BASE = '/api';
const HEADERS = { 'X-Booth-Export': '1' };

export const QUALITIES = [
  { id: 'draft', name: 'Draft', hint: 'Fastest, smaller file' },
  { id: 'standard', name: 'Standard', hint: 'Balanced', recommended: true },
  { id: 'high', name: 'High', hint: 'Best quality, slower' },
];

export const sizeHeight = size => Number(String(size).split('x')[1]) || 1080;
export function sizeHint(size) {
  const h = sizeHeight(size);
  return h <= 540 ? 'Tiny files, good for quick checks' : h <= 720 ? 'Small files, quick to share'
    : h <= 1080 ? 'Matches the layout exactly: best for most booth screens'
    : 'Upscaled from the 1920 × 1080 layout, so text and panels are softer than native, and it is much slower';
}
// How much longer than 1080p Standard an export takes, roughly: pixels encoded, times the encoder's effort.
export function slowdown(size, quality) {
  const px = sizeHeight(size) / 1080;
  const effort = { draft: 0.6, standard: 1, high: 1.8 }[quality] ?? 1;
  return px * px * effort;
}

async function json(path, options = {}) {
  const res = await fetch(BASE + path, { ...options, headers: { ...HEADERS, ...(options.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `The export service answered ${res.status}`);
  return body;
}
const post = (path, body) => json(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body),
  headers: body === undefined ? {} : { 'Content-Type': 'application/json' } });

export async function getInfo() {
  try {
    const res = await fetch(`${BASE}/info`, { headers: HEADERS });
    const info = res.ok ? await res.json() : null;
    return info?.ok ? info : null;
  } catch { return null; }
}

// PUT one video as the raw request body, reporting progress (fetch cannot report upload progress, XHR can).
function upload(jobId, slot, file, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${BASE}/jobs/${jobId}/media/${slot}`);
    xhr.setRequestHeader('X-Booth-Export', '1');
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = `Upload failed (${xhr.status})`;
      try { message = JSON.parse(xhr.responseText).error || message; } catch { /* keep the generic message */ }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('Lost the connection to the export service while uploading'));
    xhr.onabort = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
});

/**
 * Send the project, upload the videos it uses, render, and resolve with { job, token, view } once the video is ready.
 * project is the project file's JSON text; files maps media id to the File to upload.
 * onUpdate({ phase, fraction, message, fps, eta, uploaded, total }) is called as things move along.
 * Aborting the signal cancels the export and removes its working files.
 */
export async function runExport({ project, files, size, quality, fast, audio = true, filename, kind = 'video', onUpdate, signal }) {
  const created = await post('/jobs', { project: JSON.parse(project), size, quality, fast, audio, filename, kind });
  const job = created.id;
  try {
    const list = created.media.map((id, slot) => {
      const file = files.get(id);
      if (!file) throw new Error(`${created.names[slot]} is not linked: relink it in Videos`);
      return { slot, file };
    });
    const total = list.reduce((sum, item) => sum + item.file.size, 0);
    let done = 0;
    for (const { slot, file } of list) {
      await upload(job, slot, file, loaded => onUpdate({
        phase: 'uploading', fraction: total ? (done + loaded) / total : 1, uploaded: done + loaded, total,
        message: list.length > 1 ? `Uploading video ${slot + 1} of ${list.length}` : 'Reading your video',
      }), signal);
      done += file.size;
    }
    await post(`/jobs/${job}/start`);
    for (;;) {
      await sleep(500, signal);
      const view = await json(`/jobs/${job}`);
      if (view.status === 'done') return { job, token: created.token, view };
      if (view.status === 'error') throw new Error(view.message || 'The export failed');
      if (view.status === 'cancelled') throw new DOMException('Cancelled', 'AbortError');
      onUpdate({ phase: view.status, fraction: view.progress, message: view.message, fps: view.fps, eta: view.eta });
    }
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') {
      await post(`/jobs/${job}/cancel`).catch(() => {});
      await json(`/jobs/${job}`, { method: 'DELETE' }).catch(() => {});
      throw new DOMException('Cancelled', 'AbortError');
    }
    await json(`/jobs/${job}`, { method: 'DELETE' }).catch(() => {});
    throw error;
  }
}

export const downloadUrl = (job, token) => `${BASE}/jobs/${job}/download?token=${encodeURIComponent(token)}`;
export const removeJob = job => json(`/jobs/${job}`, { method: 'DELETE' }).catch(() => {});

// What each kind of export produces: the video, or the zip holding the interactive page and its footage.
export const KINDS = {
  video: { ext: '.mp4', mime: 'video/mp4', description: 'MP4 video' },
  page: { ext: '.zip', mime: 'application/zip', description: 'Zip archive' },
};

export const canChooseLocation = () => typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

// Ask where the MP4 should go. startIn (the project's folder or file handle) makes the picker open there. It is only a
// hint, so anything that is not a real handle is ignored, and a picker that rejects it is asked again without it.
export async function chooseLocation(filename, startIn, kind = 'video') {
  const { ext, mime, description } = KINDS[kind];
  const options = { suggestedName: filename, types: [{ description, accept: { [mime]: [ext] } }] };
  const hint = startIn && typeof startIn.kind === 'string' ? toRaw(startIn) : null;
  try {
    return await window.showSaveFilePicker(hint ? { ...options, startIn: hint } : options);
  } catch (error) {
    if (hint && error.name === 'TypeError') return window.showSaveFilePicker(options);
    throw error;
  }
}

// Write the finished video to a chosen file, or ask now (picker, starting in startIn), or fall back to a plain
// browser download. Resolves with { name, where } so the dialog can say where it went.
export async function saveVideo({ job, token }, filename, { target = null, startIn = null, kind = 'video' } = {}) {
  if (target || canChooseLocation()) {
    const handle = target || await chooseLocation(filename, startIn, kind);
    const res = await fetch(downloadUrl(job, token));
    if (!res.ok) throw new Error(`Could not fetch the video (${res.status})`);
    const writable = await handle.createWritable();
    await res.body.pipeTo(writable);
    return { name: handle.name, where: 'the location you chose' };
  }
  const link = document.createElement('a');
  link.href = downloadUrl(job, token);
  link.download = filename;
  link.click();
  return { name: filename, where: "your browser's download folder (Downloads, unless you changed it)" };
}

export function formatEta(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const s = Math.max(0, Math.round(seconds));
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m left`
    : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s left` : `${s}s left`;
}
export const formatBytes = n => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
