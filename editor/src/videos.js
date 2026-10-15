// Runtime media URLs stay outside the saved project.
let nextClipId = 0;

export const clipEnd = clip => clip.start + clip.dur;
export const clipAt = (clips, t) => clips.find(c => t >= c.start - 1e-6 && t < clipEnd(c));

// Which chapter buttons a clip overlaps, by number.
export function chaptersCovered(clip, chapterStarts) {
  const starts = chapterStarts.slice().sort((a, b) => a.t - b.t);
  return [...new Set(starts.filter((c, i) => c.t < clipEnd(clip) - 0.05 &&
    (starts[i + 1]?.t ?? Infinity) > clip.start + 0.05).map(c => c.ch))];
}

// Load a file just far enough to learn its length. Rejects if the browser cannot play it.
export function loadClip(file, start) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      if (Number.isFinite(probe.duration) && probe.duration > 0) resolve({ id: ++nextClipId, name: file.name, url, dur: probe.duration, start });
      else { URL.revokeObjectURL(url); reject(new Error(`${file.name}: could not read the video length`)); }
    };
    probe.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name}: this browser cannot play that file (try H.264 .mp4)`)); };
    probe.src = url;
  });
}
export const releaseClip = clip => URL.revokeObjectURL(clip.url);
