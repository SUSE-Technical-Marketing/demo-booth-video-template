import { describe, expect, it } from 'vitest';
import { activeChapter, activeHeadline, chapterScrollAt, chapterScrollSteps, DEFAULT, fromJSON,
  headlineWords, parseTime, removeChapter, sortAll, toJSON } from './timing.js';

const fixture = count => ({
  chapters: Array.from({ length: count }, (_, i) => `Chapter ${i + 1}`),
  chapter_starts: Array.from({ length: count }, (_, i) => [i * 2, i + 1]),
  headlines: [[0, 'A *scrolling* demo']],
});

describe('timing JSON', () => {
  it('round-trips existing schema without UI IDs', () => {
    const saved = JSON.parse(toJSON(fromJSON(DEFAULT)));
    expect(saved).toEqual({ schema_version: 1, ...DEFAULT });
    expect(saved.chapter_starts[0]).toEqual([0, 1]);
  });
  it('sorts imported times and accepts more than six chapters', () => {
    const data = fixture(12);
    data.chapter_starts.reverse();
    const state = fromJSON(data);
    expect(state.chapters).toHaveLength(12);
    expect(state.chapter_starts[0].t).toBe(0);
    expect(activeChapter(state, 12)).toBe(7);
  });
  it.each([
    { chapters: [] },
    { chapter_starts: [[0, 7]] },
    { chapter_starts: [[Infinity, 1]] },
    { headlines: [[0, '']] },
    { wipe_seconds: -1 },
    { headlines_end: NaN },
  ])('rejects invalid imports: %j', overrides => {
    expect(() => fromJSON({ ...DEFAULT, ...overrides })).toThrow();
  });
  it('removes a chapter and renumbers all remaining switches', () => {
    const state = fromJSON(fixture(12));
    removeChapter(state, 3);
    expect(state.chapters).toHaveLength(11);
    expect(state.chapters[2]).toBe('Chapter 4');
    expect(state.chapter_starts[2]).toMatchObject({ t: 6, ch: 3 });
    expect(state.chapter_starts.every(c => c.ch <= 11)).toBe(true);
  });
  it('orders chapter titles by their first chronological switch and remaps references', () => {
    const state = fromJSON({
      chapters: ['Created first', 'Created second', 'Created third', 'Unused'],
      chapter_starts: [[30, 1], [0, 3], [20, 2], [40, 3]],
      headlines: [[0, 'A headline']],
    });
    expect(state.chapters).toEqual(['Created third', 'Created second', 'Created first', 'Unused']);
    expect(JSON.parse(toJSON(state)).chapter_starts).toEqual([[0, 1], [20, 2], [30, 3], [40, 1]]);
  });
  it('keeps switch objects intact and preserves titles when times change', () => {
    const state = fromJSON(fixture(3)), moved = state.chapter_starts[2];
    moved.t = 1;
    sortAll(state);
    expect(state.chapters).toEqual(['Chapter 1', 'Chapter 3', 'Chapter 2']);
    expect(state.chapter_starts[1]).toBe(moved);
    expect(moved.ch).toBe(2);
    expect(state.chapters[moved.ch - 1]).toBe('Chapter 3');
    const serialized = toJSON(state);
    sortAll(state);
    expect(toJSON(state)).toBe(serialized);
  });
});

describe('time and headline behavior', () => {
  it('accepts seconds, minutes, timeline timecode and fractional seconds', () => {
    expect(parseTime('224')).toBe(224);
    expect(parseTime('3:44')).toBe(224);
    expect(parseTime('1:03:44', 3600)).toBe(224);
    expect(parseTime('3,5')).toBe(3.5);
    for (const invalid of ['', 'oops', 'Infinity', '1::3', '-1']) {
      expect(parseTime(invalid)).toBeNaN();
    }
  });
  it('preserves multiword accents, punctuation and safe text', () => {
    expect(headlineWords('Plus *AI stack*, now <script>')).toEqual([
      { text: 'Plus', accent: false }, { text: 'AI', accent: true },
      { text: 'stack,', accent: true }, { text: 'now', accent: false }, { text: '<script>', accent: false },
    ]);
  });
  it('ends the last headline at the explicit end', () => {
    const state = fromJSON({ ...DEFAULT, headlines_end: 170 });
    expect(activeHeadline(state, 169).text).toBe(DEFAULT.headlines.at(-1)[1]);
    expect(activeHeadline(state, 170)).toBeNull();
  });
});

describe('scrolling', () => {
  it('keeps two preceding and three following chapters, clamped at the ends', () => {
    const state = fromJSON(fixture(12)), steps = chapterScrollSteps(state);
    expect(chapterScrollAt(0, steps)).toBe(0);
    expect(chapterScrollAt(12.4, steps)).toBe(4);
    expect(chapterScrollAt(22.4, steps)).toBe(6);
    expect(chapterScrollAt(12.2, steps)).toBeCloseTo(3.5);
    expect(chapterScrollAt(0, steps)).toBe(0);
  });
  it('handles interrupted scrolls and simultaneous switches', () => {
    const state = fromJSON(fixture(12));
    state.chapter_starts = [{ t: 0, ch: 1 }, { t: 1, ch: 7 }, { t: 1.2, ch: 12 }, { t: 1.2, ch: 4 }];
    const steps = chapterScrollSteps(state);
    expect(chapterScrollAt(1.2, steps)).toBeCloseTo(2);
    expect(chapterScrollAt(1.4, steps)).toBeCloseTo(1.5);
    expect(chapterScrollAt(1.6, steps)).toBeCloseTo(1);
  });
  it('sorts nudged switch times without moving focused rows', () => {
    const state = fromJSON(fixture(12));
    state.chapter_starts[3].t = 30;
    const originalOrder = state.chapter_starts.map(c => c.id);
    expect(chapterScrollAt(30.4, chapterScrollSteps(state))).toBe(1);
    expect(state.chapter_starts.map(c => c.id)).toEqual(originalOrder);
  });
  it.each([1, 2, 3, 4, 5, 6])('keeps %i chapters static', count => {
    const steps = chapterScrollSteps(fromJSON(fixture(count)));
    expect(chapterScrollAt(100, steps)).toBe(0);
  });
});
