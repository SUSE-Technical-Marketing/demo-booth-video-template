import { describe, expect, it } from 'vitest';
import { clipEnd, freezeFrame, freezeProblem, resizeFreeze, rippleDelete } from './edits.js';
import { fromJSON, headlineTime } from './timing.js';
import { validateProject, toProjectJSON, createProject, fromProject } from './project.js';

// One 60 s recording on the timeline from 0, with three chapters and a headline in each.
const timing = () => fromJSON({
  schema_version: 2, title: 't', product_name: 'p',
  chapters: [
    { title: 'A', start: 0, headlines: [[0, 'one'], [10, 'two', 18]] },
    { title: 'B', start: 20, headlines: [[0, 'three']] },
    { title: 'C', start: 40, headlines: [[5, 'four']] },
  ],
});
const base = (clips = [{ id: 'm', media_id: 'x', start: 0, source_in: 0, source_out: 60 }]) =>
  ({ ...timing(), output: { fps: '25/1' }, media: [{ id: 'x', path: 'x.mp4' }], clips });
const summary = state => state.clips.map(c => [c.start, c.source_in, c.source_out, c.freeze ? 'F' : '-']);
const chapterTimes = state => state.chapter_starts.map(c => c.t);
const headlineTimes = state => state.headlines.map(h => [h.text, headlineTime(state, h), h.end]);
const valid = state => validateProject({ project_version: 1, output: state.output, media: state.media, clips: state.clips,
  timing: { schema_version: 2 } });

describe('freeze frame', () => {
  it('insert splits the video, adds the hold and pushes everything after it later', () => {
    const { state, clipId } = freezeFrame(base(), 25, 4);
    expect(summary(state)).toEqual([[0, 0, 25, '-'], [25, 25, 29, 'F'], [29, 25, 60, '-']]);
    expect(state.clips[1].id).toBe(clipId);
    expect(new Set(state.clips.map(c => c.id)).size).toBe(3);
    expect(clipEnd(state.clips[2])).toBe(64);
    valid(state);
  });

  it('insert moves chapters and headlines after the playhead but not the ones before or exactly at it', () => {
    const { state } = freezeFrame(base(), 20, 5);                    // at the start of chapter B
    expect(chapterTimes(state)).toEqual([0, 20, 45]);                // B stays (the hold plays inside it), C moves
    expect(headlineTimes(state)).toEqual([['one', 0, null], ['two', 10, 18], ['three', 20, null], ['four', 50, null]]);
  });

  it('insert stretches a headline that is showing across the playhead, including an explicit end', () => {
    const { state } = freezeFrame(base(), 14, 3);                    // inside "two" (10 to 18)
    const two = state.headlines.find(h => h.text === 'two');
    expect(headlineTime(state, two)).toBe(10);
    expect(two.end).toBe(21);                                        // it was due to end at 18; the 3 s hold keeps it up until 21
  });

  it('can leave the chapters and headlines alone', () => {
    const { state } = freezeFrame(base(), 25, 4, { shiftTiming: false });
    expect(chapterTimes(state)).toEqual([0, 20, 40]);
    expect(summary(state)[2]).toEqual([29, 25, 60, '-']);
  });

  it('replace covers the next seconds of video and moves nothing after it', () => {
    const { state } = freezeFrame(base(), 25, 4, { mode: 'replace' });
    expect(summary(state)).toEqual([[0, 0, 25, '-'], [25, 25, 29, 'F'], [29, 29, 60, '-']]);   // video resumes where it would have been
    expect(chapterTimes(state)).toEqual([0, 20, 40]);
    valid(state);
  });

  it('replace can cut across several clips and past the end', () => {
    const clips = [{ id: 'a', media_id: 'x', start: 0, source_in: 0, source_out: 10 },
      { id: 'b', media_id: 'x', start: 12, source_in: 20, source_out: 30 }];
    const { state } = freezeFrame(base(clips), 8, 6, { mode: 'replace' });         // 8 to 14 covers the end of a, the gap and the start of b
    expect(summary(state)).toEqual([[0, 0, 8, '-'], [8, 8, 14, 'F'], [14, 22, 30, '-']]);
    const past = freezeFrame(base([clips[0]]), 8, 6, { mode: 'replace' }).state;      // holds beyond the video's end
    expect(summary(past)).toEqual([[0, 0, 8, '-'], [8, 8, 14, 'F']]);
    valid(state); valid(past);
  });

  it('works at the very start and very end of a clip without leaving empty pieces', () => {
    const atStart = freezeFrame(base(), 0, 2).state;
    expect(summary(atStart)).toEqual([[0, 0, 2, 'F'], [2, 0, 60, '-']]);
    expect(atStart.clips.find(c => !c.freeze).id).toBe('m');                         // the original clip keeps its id
    const nearEnd = freezeFrame(base(), 59.99, 2).state;
    expect(summary(nearEnd)).toEqual([[0, 0, 59.99, '-'], [59.99, 59.99, 61.99, 'F']]);
    valid(atStart); valid(nearEnd);
  });

  it('shifts later clips and keeps gaps', () => {
    const clips = [{ id: 'a', media_id: 'x', start: 0, source_in: 0, source_out: 10 },
      { id: 'b', media_id: 'x', start: 15, source_in: 0, source_out: 10 }];
    const { state } = freezeFrame(base(clips), 5, 3);
    expect(summary(state)).toEqual([[0, 0, 5, '-'], [5, 5, 8, 'F'], [8, 5, 10, '-'], [18, 0, 10, '-']]);
  });

  it('explains why it cannot freeze, and rejects tiny holds', () => {
    expect(freezeProblem(base(), 30)).toBeNull();
    expect(freezeProblem(base(), 61)).toContain('no video');
    const frozen = freezeFrame(base(), 10, 3).state;
    expect(freezeProblem(frozen, 11)).toContain('already a freeze');
    expect(() => freezeFrame(frozen, 11, 2)).toThrow('already a freeze');
    expect(() => freezeFrame(base(), 10, 0.01)).toThrow('at least');
    expect(() => freezeFrame(base(), 80, 3)).toThrow('no video');
  });

  it('does not change the state it is given', () => {
    const before = base();
    const snapshot = JSON.stringify(before);
    freezeFrame(before, 25, 4);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('resizing a freeze frame', () => {
  const frozen = () => freezeFrame(base(), 25, 4).state;
  const hold = state => state.clips.find(c => c.freeze);
  const shape = state => [summary(state), chapterTimes(state), headlineTimes(state)];

  it('lengthening pushes the rest later, shortening closes the gap, chapters and headlines follow', () => {
    const start = frozen();
    const longer = resizeFreeze(start, hold(start).id, 7).state;
    expect(summary(longer)).toEqual([[0, 0, 25, '-'], [25, 25, 32, 'F'], [32, 25, 60, '-']]);
    expect(chapterTimes(longer)).toEqual([0, 20, 47]);                       // C was at 40, +4 from the insert, +3 now
    const shorter = resizeFreeze(start, hold(start).id, 1).state;
    expect(summary(shorter)).toEqual([[0, 0, 25, '-'], [25, 25, 26, 'F'], [26, 25, 60, '-']]);
    expect(chapterTimes(shorter)).toEqual([0, 20, 41]);
    valid(longer); valid(shorter);
  });

  it('is repeatable, so dragging an edge back and forth ends exactly where it started', () => {
    const start = frozen();
    let state = start;
    for (const length of [5, 9, 2, 4]) state = resizeFreeze(state, hold(start).id, length).state;
    expect(shape(state)).toEqual(shape(start));
    expect(state.clips).toEqual(start.clips);
  });

  it('keeps a minimum length and refuses a clip that is not a freeze', () => {
    const start = frozen();
    const tiny = hold(resizeFreeze(start, hold(start).id, 0.001).state);
    expect(tiny.source_out - tiny.source_in).toBeCloseTo(0.1);
    expect(() => resizeFreeze(start, 'm', 3)).toThrow('not a freeze');
  });

  it('can leave the chapters alone', () => {
    const start = frozen();
    const state = resizeFreeze(start, hold(start).id, 7, { shiftTiming: false }).state;
    expect(chapterTimes(state)).toEqual([0, 20, 44]);
    expect(summary(state)[2]).toEqual([32, 25, 60, '-']);
  });
});

describe('ripple delete', () => {
  it('removes seven seconds from the middle of a clip and closes the gap', () => {
    const { state, removed } = rippleDelete(base(), 20, 27);
    expect(removed).toBe(7);
    expect(summary(state)).toEqual([[0, 0, 20, '-'], [20, 27, 60, '-']]);       // plays 0-20 then 27-60
    expect(clipEnd(state.clips[1])).toBe(53);
    expect(new Set(state.clips.map(c => c.id)).size).toBe(2);
    valid(state);
  });

  it('moves chapters and headlines after the cut, and pulls ones inside it back to the cut point', () => {
    const { state, inside } = rippleDelete(base(), 8, 22);                       // takes the start of B and the headline "two"
    expect(chapterTimes(state)).toEqual([0, 8, 26]);                            // B (20) was inside -> 8, C 40 -> 26
    expect(inside).toEqual({ chapters: 1, headlines: 2 });          // B and the headlines at 10 and 20
    expect(headlineTimes(state).map(([text, t]) => [text, t])).toEqual([['one', 0], ['two', 8], ['three', 8], ['four', 31]]);
    expect(state.headlines.find(h => h.text === 'two').end).toBeNull();          // its explicit end no longer fits
  });

  it('shrinks an explicit headline end that spans the cut', () => {
    const { state } = rippleDelete(base(), 12, 15);                              // inside "two" (10 to 18)
    expect(state.headlines.find(h => h.text === 'two').end).toBe(15);
  });

  it('trims one clip, removes whole clips, and moves later ones across a range that spans several', () => {
    const clips = [{ id: 'a', media_id: 'x', start: 0, source_in: 0, source_out: 10 },
      { id: 'b', media_id: 'x', start: 10, source_in: 0, source_out: 5 },
      { id: 'c', media_id: 'x', start: 20, source_in: 3, source_out: 13 }];
    const { state } = rippleDelete(base(clips), 7, 22);
    expect(summary(state)).toEqual([[0, 0, 7, '-'], [7, 5, 13, '-']]);          // b gone; c keeps its tail (source 5 to 13)
    valid(state);
  });

  it('can cut through a freeze frame, keeping a shorter hold', () => {
    const frozen = freezeFrame(base(), 25, 6).state;                            // hold is 25 to 31
    const { state } = rippleDelete(frozen, 27, 29);
    expect(summary(state)).toEqual([[0, 0, 25, '-'], [25, 25, 29, 'F'], [29, 25, 60, '-']]);      // the 6 s hold is now 4 s
    valid(state);
  });

  it('can leave the timing alone, and refuses an empty range or a range with no video', () => {
    expect(chapterTimes(rippleDelete(base(), 8, 22, { shiftTiming: false }).state)).toEqual([0, 20, 40]);
    expect(() => rippleDelete(base(), 10, 10)).toThrow('end after its start');
    expect(() => rippleDelete(base(), 70, 80)).toThrow('no video');
  });

  it('drops pieces shorter than a frame instead of creating invalid clips', () => {
    const { state } = rippleDelete(base(), 0.01, 59.99);                        // leaves two slivers
    expect(state.clips).toHaveLength(0);
  });

  it('survives a save and reload as a project file', () => {
    const edited = rippleDelete(freezeFrame(base(), 25, 4).state, 40, 45).state;
    const project = { ...createProject({ schema_version: 2, chapters: [{ title: 'A', start: 0, headlines: [] }] }), ...edited };
    const text = toProjectJSON(project);
    const reloaded = fromProject(JSON.parse(text));
    expect(reloaded.clips.map(c => [c.start, c.source_in, c.source_out, !!c.freeze]))
      .toEqual(edited.clips.map(c => [c.start, c.source_in, c.source_out, !!c.freeze]));
  });
});
