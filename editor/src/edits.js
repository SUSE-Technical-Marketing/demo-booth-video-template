// Editing the timeline: freeze frames and ripple delete. Everything here is a pure function: it takes the editor state
// and returns a changed copy (or throws an Error whose message is meant for the user), so the app can record one undo
// step and the rules can be tested without a browser.
import { sortAll } from './timing.js';
import { validateProject } from './project.js';

const EPS = 1e-6;
const round = value => +value.toFixed(2);
const clone = state => JSON.parse(JSON.stringify(state));
const newId = () => crypto.randomUUID();

export function setDissolve(state, clipId, duration) {
  if (!Number.isFinite(duration) || duration < 0) throw new Error('Enter a non-negative dissolve duration in seconds.');
  const next = clone(state);
  next.clips.sort((a, b) => a.start - b.start);
  const index = next.clips.findIndex(c => c.id === clipId), clip = next.clips[index], previous = next.clips[index - 1];
  if (!clip || !previous) throw new Error('A dissolve needs a preceding clip.');
  const old = clip.transition_in?.duration ?? 0, boundary = clip.start + old;
  if (duration && Math.abs(clipEnd(previous) - boundary) > EPS) {
    throw new Error('Close the gap between these clips before adding a dissolve.');
  }
  if (duration >= clipLength(clip) - EPS ||
      (previous.transition_in?.duration ?? 0) + duration > clipLength(previous) - EPS ||
      duration + (next.clips[index + 1]?.transition_in?.duration ?? 0) > clipLength(clip) - EPS) {
    throw new Error('Dissolves must leave room in both clips and cannot overlap another dissolve');
  }
  const delta = old - duration;
  for (const later of next.clips.slice(index)) later.start += delta;
  if (duration) clip.transition_in = { type: 'crossfade', duration };
  else delete clip.transition_in;
  validateProject({ project_version: 1, ...next, timing: { schema_version: 2 } });
  // Keep chapter-relative headlines with the rippled footage, including ones in the old overlap.
  const start = boundary - old;
  retimeTiming(next, x => delta < 0
    ? (x <= start + delta ? x : Math.max(start + delta, x + delta))
    : (x >= start - EPS ? x + delta : x));
  return { state: next };
}

export const clipLength = clip => clip.source_out - clip.source_in;
export const clipEnd = clip => clip.start + clipLength(clip);
export const MIN_FREEZE = 0.1;

export function reorderClip(state, clipId, beforeId = null) {
  const next = clone(state);
  const ordered = next.clips.slice().sort((a, b) => a.start - b.start);
  const clip = ordered.find(c => c.id === clipId);
  if (!clip || (beforeId !== null && !ordered.some(c => c.id === beforeId))) {
    throw new Error('The clip to move or its destination no longer exists.');
  }
  if (clipId === beforeId) return { state: next, changed: false, removedTransitions: [] };
  const clips = ordered.filter(c => c.id !== clipId);
  clips.splice(beforeId === null ? clips.length : clips.findIndex(c => c.id === beforeId), 0, clip);
  if (clips.every((c, i) => c.id === ordered[i].id)) return { state: next, changed: false, removedTransitions: [] };
  const removedTransitions = [];
  for (const [i, current] of clips.entries()) {
    const previous = clips[i - 1], duration = current.transition_in?.duration;
    if (duration != null && (!previous || duration >= clipLength(current) - EPS ||
        duration + (previous.transition_in?.duration ?? 0) > clipLength(previous) - EPS)) {
      removedTransitions.push(current.id);
      delete current.transition_in;
    }
    current.start = previous ? clipEnd(previous) - (current.transition_in?.duration ?? 0) : 0;
  }
  next.clips = clips;
  validateProject({ project_version: 1, ...next, timing: { schema_version: 2 } });
  return { state: next, changed: true, removedTransitions };
}

// A freeze clip holds the frame at source_in for its whole length (source_out - source_in).
const piece = (clip, start, sourceIn, length, extra = {}) => {
  const next = { ...clip, ...extra, start, source_in: sourceIn, source_out: sourceIn + length };
  if (start > clip.start + EPS) delete next.transition_in;
  return next;
};

/**
 * Remove the timeline range [from, to) from the clips without moving anything: a clip that spans the range is split
 * in two, one that overlaps one end is trimmed. Pieces shorter than min (one frame) are dropped.
 */
function cutRange(clips, from, to, min) {
  const out = [];
  for (const clip of clips) {
    const start = clip.start, end = clipEnd(clip);
    if (end <= from + EPS || start >= to - EPS) { out.push(clip); continue; }
    const head = start < from - EPS ? piece(clip, start, clip.source_in, from - start) : null;
    const tailIn = clip.freeze ? clip.source_in : clip.source_in + (to - start);
    const tail = end > to + EPS ? piece(clip, to, tailIn, end - to, head ? { id: newId() } : {}) : null;
    for (const kept of [head, tail]) if (kept && clipLength(kept) >= min - EPS) out.push(kept);
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Move chapter starts, headlines and the end settings through a time map (monotonic, so order is kept). Headlines
 * are stored relative to their chapter, so their absolute times are mapped first and made relative again after.
 */
function retimeTiming(state, map) {
  const chapterOf = h => state.chapter_starts.find(c => c.id === h.chapterId);
  const absolute = new Map(state.headlines.map(h => {
    const chapter = chapterOf(h);
    return [h.id, { start: chapter.t + h.t, end: h.end == null ? null : chapter.t + h.end }];
  }));
  state.chapter_starts.forEach(chapter => { chapter.t = Math.max(0, round(map(chapter.t))); });
  state.headlines.forEach(h => {
    const chapter = chapterOf(h), when = absolute.get(h.id);
    h.t = round(map(when.start) - chapter.t);
    h.end = when.end == null ? null : round(map(when.end) - chapter.t);
    if (h.end != null && h.end <= h.t + EPS) h.end = null;
  });
  if (state.headlines_end != null) state.headlines_end = Math.max(0, round(map(state.headlines_end)));
  if (state.chapters_end != null) state.chapters_end = Math.max(0.01, round(map(state.chapters_end)));
  sortAll(state);
}

// A cut inside a freeze leaves a head and a tail of the same hold; after the gap closes they are one shorter hold.
function mergeHolds(clips) {
  const out = [];
  for (const clip of clips) {
    const last = out[out.length - 1];
    if (last?.freeze && clip.freeze && last.media_id === clip.media_id && Math.abs(last.source_in - clip.source_in) < EPS &&
        Math.abs(clipEnd(last) - clip.start) < EPS) out[out.length - 1] = { ...last, source_out: last.source_out + clipLength(clip) };
    else out.push(clip);
  }
  return out;
}

const clipAtTime = (clips, t) => clips.find(c => t >= c.start - EPS && t < clipEnd(c) - EPS);

/** Why a freeze frame cannot be made at t (nothing to freeze, or it is already one), or null if it can. */
export function freezeProblem(state, t) {
  if (state.clips.filter(c => t >= c.start - EPS && t < clipEnd(c) - EPS).length > 1) {
    return 'Remove the dissolve before freezing a frame inside its overlap.';
  }
  const clip = clipAtTime(state.clips, t);
  if (!clip) return 'There is no video at the playhead. Move it onto a video to freeze that frame.';
  if (clip.freeze) return 'This is already a freeze frame. Drag its right edge or change its length instead.';
  return null;
}

/**
 * Freeze the frame under t for `length` seconds.
 *   mode 'insert':  the video is split at t, the freeze goes in, and everything after moves later by `length`.
 *   mode 'replace': the freeze covers the next `length` seconds of the timeline, cutting away whatever was there;
 *                   nothing after it moves.
 * With shiftTiming, insert also moves the chapters and headlines after t, so they stay with the video they described.
 * Items exactly at t stay, so a headline that starts here is still showing during the freeze.
 */
export function freezeFrame(state, t, length, { mode = 'insert', shiftTiming = true, min = 0.04 } = {}) {
  if (!(length >= MIN_FREEZE)) throw new Error(`A freeze frame must be at least ${MIN_FREEZE} seconds long.`);
  const problem = freezeProblem(state, t);
  if (problem) throw new Error(problem);
  const next = clone(state), source = clipAtTime(next.clips, t), frame = source.source_in + (t - source.start);
  const freeze = { id: newId(), media_id: source.media_id, start: t, source_in: frame, source_out: frame + length, freeze: true };
  let clips;
  if (mode === 'replace') {
    clips = cutRange(next.clips, t, t + length, min);
  } else {
    const end = clipEnd(source);
    clips = [];
    for (const clip of next.clips) {
      if (clip.id !== source.id) { clips.push(clip.start >= t - EPS ? { ...clip, start: clip.start + length } : clip); continue; }
      if (t - clip.start >= min - EPS) clips.push(piece(clip, clip.start, clip.source_in, t - clip.start));
      if (end - t >= min - EPS) {
        clips.push(piece(clip, t + length, frame, end - t, t - clip.start >= min - EPS ? { id: newId() } : {}));
      }
    }
  }
  next.clips = [...clips, freeze].sort((a, b) => a.start - b.start);
  if (shiftTiming && mode !== 'replace') retimeTiming(next, x => (x > t + EPS ? x + length : x));
  return { state: next, clipId: freeze.id };
}

/**
 * Change how long a freeze lasts. Everything after it moves with its end (a ripple), including the chapters and
 * headlines when shiftTiming is on, so lengthening a hold never overlaps the next clip and shortening it closes up.
 */
export function resizeFreeze(state, clipId, length, { shiftTiming = true } = {}) {
  const next = clone(state), freeze = next.clips.find(c => c.id === clipId);
  if (!freeze?.freeze) throw new Error('That clip is not a freeze frame.');
  const length0 = clipLength(freeze), end0 = freeze.start + length0, length1 = Math.max(MIN_FREEZE, length);
  const delta = length1 - length0, end1 = freeze.start + length1;
  const incoming = next.clips.find(c => c.transition_in && Math.abs(c.start + c.transition_in.duration - end0) < EPS);
  next.clips = next.clips.map(clip => {
    if (clip.id === clipId) return { ...clip, source_out: clip.source_in + length1 };
    return clip.start > freeze.start + EPS ? { ...clip, start: clip.start + delta } : clip;
  }).sort((a, b) => a.start - b.start);
  const boundary = incoming?.start ?? end0;
  if (shiftTiming && Math.abs(delta) > EPS) retimeTiming(next, x => (x >= boundary - EPS ? x + delta : Math.min(x, boundary + delta)));
  return { state: next };
}

/**
 * Remove the timeline range [from, to) and close the gap: clips are trimmed or split around it and everything after
 * moves earlier by the length of the range (a ripple delete). With shiftTiming the chapters and headlines after the
 * range move too; any inside it are pulled back to the cut point rather than deleted.
 */
export function rippleDelete(state, from, to, { shiftTiming = true, min = 0.04 } = {}) {
  if (!(to > from + EPS)) throw new Error('Choose a range with an end after its start.');
  const next = clone(state), span = to - from;
  if (!next.clips.some(c => c.start < to - EPS && clipEnd(c) > from + EPS)) {
    throw new Error('There is no video in that range.');
  }
  next.clips = mergeHolds(cutRange(next.clips, from, to, min)
    .map(clip => (clip.start >= to - EPS ? { ...clip, start: clip.start - span } : clip)));
  const inside = { chapters: 0, headlines: 0 };
  if (shiftTiming) {
    inside.chapters = next.chapter_starts.filter(c => c.t > from + EPS && c.t < to - EPS).length;
    inside.headlines = next.headlines.filter(h => {
      const t = next.chapter_starts.find(c => c.id === h.chapterId).t + h.t;
      return t > from + EPS && t < to - EPS;
    }).length;
    retimeTiming(next, x => (x <= from ? x : x >= to ? x - span : from));
  }
  return { state: next, removed: span, inside };
}
