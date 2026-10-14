import { describe, expect, it } from 'vitest';
import { activeChapter, activeHeadline, chapterImportNotice, chapterScrollAt, chapterScrollSteps, DEFAULT, fromJSON,
  headlineEnd, headlineOutside, headlineTime, headlineWords, parseTime, removeChapter, sortAll, toJSON } from './timing.js';

const fixture = count => ({
  chapters: Array.from({ length: count }, (_, i) => `Chapter ${i + 1}`),
  chapter_starts: Array.from({ length: count }, (_, i) => [i * 2, i + 1]),
  headlines: [[0, 'A *scrolling* demo']],
});

describe('timing JSON', () => {
  it('migrates existing schema to nested chapter-relative headlines without UI IDs', () => {
    const state = fromJSON(DEFAULT), saved = JSON.parse(toJSON(state));
    expect(saved.schema_version).toBe(2);
    expect(saved.chapters[1]).toEqual({
      title: DEFAULT.chapters[1], start: 30,
      headlines: [[0, DEFAULT.headlines[2][1]], [15, DEFAULT.headlines[3][1]]],
    });
    expect(state.headlines.map(h => [headlineTime(state, h), h.text])).toEqual(DEFAULT.headlines);
    expect(JSON.parse(toJSON(fromJSON(saved)))).toEqual(saved);
    expect(saved.chapter_starts).toBeUndefined();
    expect(saved.headlines).toBeUndefined();
    expect(toJSON(state)).not.toContain('chapterId');
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
  it('removes a chapter and renumbers all remaining chapters', () => {
    const state = fromJSON(fixture(12));
    removeChapter(state, 3);
    expect(state.chapters).toHaveLength(11);
    expect(state.chapters[2]).toBe('Chapter 4');
    expect(state.chapter_starts[2]).toMatchObject({ t: 6, ch: 3 });
    expect(state.chapter_starts.every(c => c.ch <= 11)).toBe(true);
  });
  it('converts every legacy segment to an independent chapter in chronological order', () => {
    const source = {
      chapters: ['Created first', 'Created second', 'Created third', 'Unused'],
      chapter_starts: [[30, 1], [0, 3], [20, 2], [40, 3]],
      headlines: [[0, 'A headline']],
    };
    const state = fromJSON(source);
    expect(state.chapters).toEqual(['Created third', 'Created second', 'Created first', 'Created third']);
    expect(JSON.parse(toJSON(state)).chapters.map(c => c.start)).toEqual([0, 20, 30, 40]);
    expect(chapterImportNotice(source)).toContain('Converted repeated chapter switches');
    expect(chapterImportNotice(source)).toContain('unused chapter titles');
    state.chapters[0] = 'Renamed first segment';
    expect(state.chapters[3]).toBe('Created third');
    expect(source.chapters[2]).toBe('Created third');
    expect(activeChapter(state, 40)).toBe(4);
    expect(chapterImportNotice(JSON.parse(toJSON(state)))).toBe('');
  });
  it('rejects exporting chapter reuse or missing chapter starts', () => {
    const state = fromJSON(fixture(3));
    state.chapter_starts[2].ch = 1;
    expect(() => toJSON(state)).toThrow('exactly one start');
    state.chapter_starts[2].ch = 3;
    state.chapter_starts[0].t = 10;
    expect(() => toJSON(state)).toThrow('timeline order');
    state.chapter_starts[0].t = 0;
    state.chapters.push('Unscheduled');
    expect(() => toJSON(state)).toThrow('exactly one start');
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

describe('chapter-owned headlines', () => {
  const source = {
    schema_version: 2,
    chapters: [
      { title: 'Intro', start: 0, headlines: [[0, 'First'], [8, 'Last'], [12, 'Outside']] },
      { title: 'Empty', start: 10, headlines: [] },
      { title: 'Later', start: 20, headlines: [[3, 'Delayed']] },
    ],
  };
  it('clips at the chapter boundary and clears empty or delayed chapters', () => {
    const state = fromJSON(source), last = state.headlines.find(h => h.text === 'Last');
    expect(headlineEnd(state, last)).toBe(10);
    expect(activeHeadline(state, 9.99).text).toBe('Last');
    for (const time of [10, 12, 19.99, 20, 22.99]) expect(activeHeadline(state, time)).toBeNull();
    expect(activeHeadline(state, 23)).toMatchObject({ text: 'Delayed', t: 23 });
    expect(headlineOutside(state, state.headlines.find(h => h.text === 'Outside'))).toBe(true);
    expect(JSON.parse(toJSON(state)).chapters[0].headlines).toEqual(source.chapters[0].headlines);
  });
  it('moves and reorders chapters without changing headline ownership or relative times', () => {
    const state = fromJSON(source), chapter = state.chapter_starts[2];
    const headline = state.headlines.find(h => h.text === 'Delayed');
    chapter.t = 5;
    sortAll(state);
    expect(state.chapters).toEqual(['Intro', 'Later', 'Empty']);
    expect(headline.t).toBe(3);
    expect(headline.chapterId).toBe(chapter.id);
    expect(headlineTime(state, headline)).toBe(8);
    expect(activeHeadline(state, 5)).toBeNull();
    expect(activeHeadline(state, 8).text).toBe('Delayed');
    expect(headlineOutside(state, state.headlines.find(h => h.text === 'Last'))).toBe(true);
  });
  it('removes only owned headlines when deleting a chapter and allows all-empty documents', () => {
    const state = fromJSON(source);
    removeChapter(state, 1);
    expect(state.headlines.map(h => h.text)).toEqual(['Delayed']);
    const empty = fromJSON({ schema_version: 2, chapters: [{ title: 'Empty', start: 0, headlines: [] }] });
    expect(activeHeadline(empty, 5)).toBeNull();
    expect(fromJSON(JSON.parse(toJSON(empty))).headlines).toEqual([]);
    expect(fromJSON({ ...DEFAULT, headlines: [] }).headlines).toEqual([]);
  });
  it('retains and flags legacy headlines before the first chapter', () => {
    const state = fromJSON({ chapters: ['Starts later'], chapter_starts: [[10, 1]], headlines: [[5, 'Early']] });
    expect(state.headlines[0].t).toBe(-5);
    expect(headlineOutside(state, state.headlines[0])).toBe(true);
    expect(activeHeadline(state, 5)).toBeNull();
    expect(activeHeadline(state, 20)).toBeNull();
    expect(JSON.parse(toJSON(state)).chapters[0].headlines).toEqual([[-5, 'Early']]);
  });
  it('caps at the loaded video end and optional global headline end', () => {
    const state = fromJSON(source);
    state.preview_end = 25;
    expect(activeHeadline(state, 24.99).text).toBe('Delayed');
    expect(activeHeadline(state, 25)).toBeNull();
    state.headlines_end = 24;
    expect(activeHeadline(state, 24)).toBeNull();
    expect(headlineEnd(state, state.headlines.at(-1), 25)).toBe(24);
  });
  it.each([
    { schema_version: 3, chapters: [] },
    { schema_version: 2, chapters: [{ title: 'Bad', start: -1, headlines: [] }] },
    { schema_version: 2, chapters: [{ title: 'Bad', start: 0, headlines: [[NaN, 'Text']] }] },
    { schema_version: 2, chapters: [{ title: 'Bad', start: 0, headlines: [[0, '']] }] },
  ])('rejects invalid chapter documents: %j', document => {
    expect(() => fromJSON(document)).toThrow();
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
