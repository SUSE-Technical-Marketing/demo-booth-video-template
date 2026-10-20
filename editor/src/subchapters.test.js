import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChapterEditor from './components/ChapterEditor.vue';
import ChapterRow from './components/ChapterRow.vue';
import Preview from './components/Preview.vue';
import { chapterLabels, chapterLevels, chapterNumber, chapterScrollSteps, fromJSON, removeChapter, toJSON, visibleRows } from './timing.js';

const ROWS = [['Intro', 0], ['Blueprints', 0], ['Install', 1], ['Create', 1], ['Observe', 0], ['Traces', 0]];
const doc = (rows = ROWS) => ({ schema_version: 2, product_name: 'P', chapters: rows.map(([title, level], i) =>
  ({ title, start: i * 10, ...(level ? { level } : {}), headlines: [[0, `About *${title}*`]] })) });
const withTheme = (theme, rows) => ({ ...fromJSON(doc(rows)), output: { fps: '25/1', theme } });
const props = state => ({ state, cur: 5, headlinePx: 70, pillPx: 28, productPx: 56 });
const levels = [0, 0, 1, 1, 0, 0];

describe('sub-chapter timing', () => {
  it('saves a level only for sub-chapters and reads it back', () => {
    const saved = JSON.parse(toJSON(fromJSON(doc())));
    expect(saved.chapters.map(c => c.level)).toEqual([undefined, undefined, 1, 1, undefined, undefined]);
    expect(fromJSON(saved).chapter_starts.map(c => c.level)).toEqual(levels);
  });
  it('rejects a level that is not 0 or 1', () => {
    const bad = doc();
    bad.chapters[2].level = 2;
    expect(() => fromJSON(bad)).toThrow('level');
  });
  it('never lets the first chapter be a sub-chapter', () => {
    const state = fromJSON(doc([['A', 1], ['B', 1]]));
    expect(state.chapter_starts.map(c => c.level)).toEqual([0, 1]);
  });
  it('promotes the sub-chapters of a deleted chapter instead of attaching them to the one before', () => {
    const state = fromJSON(doc());
    removeChapter(state, 2);
    expect(state.chapters).toEqual(['Intro', 'Install', 'Create', 'Observe', 'Traces']);
    expect(state.chapter_starts.map(c => c.level)).toEqual([0, 0, 0, 0, 0]);
  });
  it('keeps the sub-chapters when one of them is deleted', () => {
    const state = fromJSON(doc());
    removeChapter(state, 3);
    expect(chapterLevels(state)).toEqual([0, 0, 1, 0, 0]);
  });
  it('numbers chapters and sub-chapters, and counts chapters only', () => {
    expect(chapterLabels(levels)).toEqual(['1', '2', '2.1', '2.2', '3', '4']);
    expect(chapterNumber(levels, 4)).toEqual([2, 4]);
    expect(chapterNumber(levels, 5)).toEqual([3, 4]);
  });
  it('lists a chapter\'s sub-chapters only while it is playing', () => {
    expect(visibleRows(levels, 1)).toEqual([1, 2, 5, 6]);
    expect(visibleRows(levels, 2)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(visibleRows(levels, 4)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('jumps rather than scrolls when another chapter opens', () => {
    const state = fromJSON(doc());
    const steps = chapterScrollSteps(state, { visible: 3, previous: 1, seconds: 0.4 }, levels);
    steps.filter(step => step.t === 10).forEach(step => expect(step.origin).toBe(step.target));
  });
});

describe('sub-chapters in the preview', () => {
  beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
  afterEach(() => vi.unstubAllGlobals());
  const titles = wrapper => wrapper.findAll('.pill').map(p => p.text());

  it('shows only chapters until one of them is playing', async () => {
    const preview = mount(Preview, { props: { ...props(withTheme('dark-rail')), cur: 5 } });
    expect(titles(preview)).toEqual(['Intro', 'Blueprints', 'Observe', 'Traces']);
    expect(preview.get('#chapterCounter').text()).toBe('Chapter 1 of 4');
    await preview.setProps({ cur: 15 });
    expect(titles(preview)).toEqual(['Intro', 'Blueprints', 'Install', 'Create', 'Observe', 'Traces']);
    expect(preview.get('.pill.on').text()).toBe('Blueprints');                  // its own introduction
    await preview.setProps({ cur: 25 });
    expect(preview.get('.pill.opened').text()).toBe('Blueprints');
    expect(preview.get('.pill.on').text()).toBe('Install');
    expect(preview.get('.pill.on').element.dataset.number).toBe('2.1');
    expect(preview.get('#chapterCounter').text()).toBe('Chapter 2 of 4');
  });
  it('keeps a chapter open while its sub-chapters play and closes it afterwards', async () => {
    const preview = mount(Preview, { props: { ...props(withTheme('classic')), cur: 35 } });
    expect(titles(preview)).toHaveLength(6);
    expect(preview.get('.pill.on').text()).toBe('Create');
    await preview.setProps({ cur: 45 });
    expect(titles(preview)).toEqual(['Intro', 'Blueprints', 'Observe', 'Traces']);
  });
  it('draws sub-chapter buttons smaller and indented in the classic theme', async () => {
    const preview = mount(Preview, { props: { ...props(withTheme('classic')), cur: 15 } });
    const [chapter, sub] = [preview.findAll('.pill')[1], preview.findAll('.pill')[2]];
    expect(parseFloat(sub.element.style.width)).toBeLessThan(parseFloat(chapter.element.style.width));
    expect(parseFloat(sub.element.style.left)).toBeGreaterThan(parseFloat(chapter.element.style.left));
  });
  it('shows every chapter as a normal one in themes without sub-chapters', () => {
    const preview = mount(Preview, { props: props(withTheme('minimal-stage')) });
    expect(titles(preview)).toHaveLength(6);
    expect(preview.get('#chapterCounter').text()).toBe('Chapter 1 of 6');
  });
  it('leaves projects without sub-chapters alone', () => {
    const preview = mount(Preview, { props: props(withTheme('dark-rail', ROWS.map(([t]) => [t, 0]))) });
    expect(titles(preview)).toHaveLength(6);
    expect(preview.get('#chapterCounter').text()).toBe('Chapter 1 of 6');
  });
});

describe('sub-chapter controls', () => {
  const rows = [['Intro', 0], ['Blueprints', 0], ['Install', 1]];

  it('offers indent on every chapter but the first, and outdent on sub-chapters', () => {
    const state = fromJSON(doc(rows));
    const editor = mount(ChapterEditor, { props: { chapters: state.chapters, starts: state.chapter_starts,
      headlines: state.headlines, offset: 0, end: 60 } });
    const buttons = editor.findAll('.crow').map(row => row.find('.level-button'));
    expect(buttons.map(b => b.exists())).toEqual([false, true, true]);
    expect(buttons[1].attributes('aria-label')).toBe('Make this a sub-chapter');
    expect(buttons[2].attributes('aria-label')).toBe('Make this a chapter again');
    expect(editor.findAll('.chapter-number').map(n => n.text())).toEqual(['1', '2', '2.1']);
    expect(editor.findAll('.crow')[2].classes()).toContain('sub');
  });
  it('asks for the opposite level when clicked', async () => {
    const state = fromJSON(doc(rows));
    const editor = mount(ChapterEditor, { props: { chapters: state.chapters, starts: state.chapter_starts,
      headlines: state.headlines, offset: 0, end: 60 } });
    await editor.findAll('.level-button')[0].trigger('click');
    await editor.findAll('.level-button')[1].trigger('click');
    expect(editor.emitted('set-chapter-level')).toEqual([[state.chapter_starts[1], 1], [state.chapter_starts[2], 0]]);
  });
  it('row shows its label', () => {
    const row = mount(ChapterRow, { props: { chapter: { id: 1, t: 0, ch: 3 }, title: 'X', label: '2.1', sub: true,
      offset: 0, duration: 5 } });
    expect(row.get('.chapter-number').text()).toBe('2.1');
  });
});
