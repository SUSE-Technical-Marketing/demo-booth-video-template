// Runtime media URLs stay outside the saved project.
let nextClipId = 0;

export const clipEnd = clip => clip.start + clip.dur;
export function clipLayersAt(clips, t) {
  const active = clips.filter(c => t >= c.start && t < clipEnd(c)).sort((a, b) => a.start - b.start);
  const incoming = active.at(-1);
  if (!incoming) return [];
  // Hard cuts select the incoming clip even if floating-point rounding leaves a tiny overlap.
  if (active.length === 1 || !incoming.transition_in) return [{ clip: incoming, gain: 1, opacity: 1 }];
  const mix = Math.max(0, Math.min(1, (t - incoming.start) / incoming.transition_in.duration));
  return [
    { clip: active.at(-2), gain: 1 - mix, opacity: 1 },
    { clip: incoming, gain: mix, opacity: mix },
  ];
}
export const clipAt = (clips, t) => clipLayersAt(clips, t).at(-1)?.clip;

// Which chapter buttons a clip overlaps, by number.
export function chaptersCovered(clip, chapterStarts) {
  const starts = chapterStarts.slice().sort((a, b) => a.t - b.t);
  return [...new Set(starts.filter((c, i) => c.t < clipEnd(clip) - 0.05 &&
    (starts[i + 1]?.t ?? Infinity) > clip.start + 0.05).map(c => c.ch))];
}

// Load a file just far enough to learn its length. Rejects if the browser cannot play it.
export function loadClip(file, start, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const url = URL.createObjectURL(file), probe = document.createElement('video');
    const finish = (error, clip) => {
      signal?.removeEventListener('abort', abort);
      probe.onloadedmetadata = probe.onerror = null;
      if (error) {
        probe.removeAttribute('src');
        URL.revokeObjectURL(url);
        reject(error);
      } else resolve(clip);
    };
    const abort = () => finish(signal.reason ?? new DOMException('Video loading cancelled', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      if (Number.isFinite(probe.duration) && probe.duration > 0) finish(null, { id: ++nextClipId, name: file.name, file, url, dur: probe.duration, start });
      else finish(new Error(`${file.name}: could not read the video length`));
    };
    probe.onerror = () => finish(new Error(`${file.name}: this browser cannot play that file (try H.264 .mp4)`));
    probe.src = url;
  });
}
export const releaseClip = clip => URL.revokeObjectURL(clip.url);
