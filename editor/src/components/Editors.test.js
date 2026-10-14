import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChapterEditor from './ChapterEditor.vue';
import ChapterRow from './ChapterRow.vue';
import DurationBadge from './DurationBadge.vue';
import HeadlineEditor from './HeadlineEditor.vue';
import HeadlineRow from './HeadlineRow.vue';
import { DEFAULT, fromJSON } from '../timing.js';

describe('chapter components', () => {
  it('separates chapter navigation and selected headlines into sibling cards', async () => {
    const state = fromJSON(DEFAULT);
    const editor = mount(ChapterEditor, { props: {
      chapters: state.chapters, starts: state.chapter_starts, headlines: state.headlines,
      selectedChapterId: state.chapter_starts[1].id, offset: 3600, end: 195,
    } });
    const cards = editor.findAll('.chapter-editor > .card');
    expect(cards).toHaveLength(2);
    expect(cards[0].get('#chapters').exists()).toBe(true);
    expect(cards[0].find('.headline-list').exists()).toBe(false);
    expect(cards[1].get('h3').text()).toBe(DEFAULT.chapters[1]);
    expect(cards[1].findAll('.headline-list .row')).toHaveLength(2);
    await editor.setProps({ selectedChapterId: state.chapter_starts[2].id });
    expect(cards[1].get('h3').text()).toBe(DEFAULT.chapters[2]);
    editor.unmount();
  });
  it('emits row edits without mutating chapter props', async () => {
    const chapter = { id: 1, t: 0, ch: 1 };
    const row = mount(ChapterRow, { props: { chapter, title: 'Intro', offset: 3600, duration: 30 } });
    await row.get('.time').trigger('focus');
    await row.get('.chapter-title').trigger('focus');
    await row.get('.chapter-title').setValue('Edited directly');
    await row.get('.chapter-title').trigger('click');
    await row.get('.time').setValue('0:30');
    expect(row.emitted('begin-edit')).toHaveLength(2);
    expect(row.emitted('update-title')).toEqual([['Edited directly']]);
    expect(row.find('select').exists()).toBe(false);
    expect(row.emitted('select')).toHaveLength(2);
    expect(row.emitted('update-time')).toEqual([[30]]);
    expect(chapter).toEqual({ id: 1, t: 0, ch: 1 });
    expect(row.props('title')).toBe('Intro');
    row.unmount();
  });
  it('does not seek when deleting a row', async () => {
    const row = mount(ChapterRow, { props: { chapter: { id: 1, t: 0, ch: 1 }, title: 'Intro', offset: 3600, duration: 30 } });
    await row.get('button[title="Delete chapter"]').trigger('click');
    expect(row.emitted('delete')).toHaveLength(1);
    expect(row.emitted('select')).toBeUndefined();
    row.unmount();
  });
  it('forwards direct chapter edits and explicit chapter selection', async () => {
    const state = fromJSON(DEFAULT);
    const editor = mount(ChapterEditor, { props: {
      chapters: state.chapters, starts: state.chapter_starts, headlines: state.headlines, offset: 3600, end: 195,
    } });
    await editor.get('#chapters input[data-chapter="1"]').setValue('Edited directly');
    await editor.get('#chapters .time').setValue('0:20');
    await editor.get('#addChapter').trigger('click');
    await editor.get('#chapters .crow button[title="Delete chapter"]').trigger('click');
    await editor.findAll('.chapter-count')[1].trigger('click');
    expect(editor.emitted('update-chapter-title')).toEqual([[1, 'Edited directly']]);
    expect(editor.emitted('delete-chapter')).toEqual([[1]]);
    expect(editor.emitted('select').at(-1)).toEqual([state.chapter_starts[1]]);
    expect(editor.emitted('update-time')[0]).toEqual([state.chapter_starts[0], 20]);
    expect(editor.emitted('add-chapter')).toHaveLength(1);
    expect(editor.find('#addChapterSwitch').exists()).toBe(false);
    expect(editor.find('#names').exists()).toBe(false);
    expect(state.chapters[0]).toBe(DEFAULT.chapters[0]);
    editor.unmount();
  });
  it('keeps rows compact with headline counts, playing indicators and duration tooltips', async () => {
    const row = mount(ChapterRow, { props: {
      chapter: { id: 1, t: 15, ch: 1 }, title: 'Intro', offset: 3600, duration: 10.5,
      headlineCount: 2, playing: true, selected: true,
    } });
    expect(row.get('.time').element.value).toBe('0:15');
    expect(row.get('.time').attributes('title')).toBe('01:00:15');
    expect(row.attributes('title')).toBe('Length 0:10.5');
    expect(row.get('.chapter-count').text()).toBe('2');
    expect(row.find('.dot.playing').exists()).toBe(true);
    expect(row.classes()).toContain('sel');
    expect(row.findComponent(DurationBadge).exists()).toBe(false);
    await row.setProps({ duration: 0 });
    expect(row.attributes('title')).toBe('Length 0:00');
    await row.setProps({ duration: -5 });
    expect(row.attributes('title')).toBe('Chapter starts after the video end');
    expect(row.get('.chapter-count').classes()).toContain('warn');
    row.unmount();
  });
  it('updates chapter lengths for time edits and preview end changes', async () => {
    const starts = [{ id: 1, t: 0, ch: 1 }, { id: 2, t: 30, ch: 2 }, { id: 3, t: 45, ch: 3 }];
    const editor = mount(ChapterEditor, { props: {
      chapters: ['Intro', 'Details', 'Ending'], starts, offset: 3600, end: 75, selectedChapterId: 3,
    } });
    const lengths = () => editor.findAll('.chapter-duration').map(badge => badge.text());
    expect(lengths()).toEqual(['Length 0:30']);
    await editor.setProps({ starts: [starts[0], { ...starts[1], t: 10 }, starts[2]] });
    await editor.setProps({ selectedChapterId: 2 });
    expect(lengths()).toEqual(['Length 0:35']);
    await editor.setProps({ end: 60 });
    await editor.setProps({ selectedChapterId: 3 });
    expect(lengths()).toEqual(['Length 0:15']);
    await editor.setProps({ end: 35 });
    expect(lengths()).toEqual(['Past end']);
    await editor.setProps({ starts: [{ ...starts[0], t: 0 }, { ...starts[1], t: 0 }] });
    expect(lengths()).toEqual(['Length 0:00']);
    await editor.setProps({ selectedChapterId: 2 });
    expect(lengths()).toEqual(['Length 0:35']);
    editor.unmount();
  });
});

describe('headline components', () => {
  it('emits text edits, Enter and playhead actions without mutating props', async () => {
    const headline = { id: 1, t: 0, text: 'An *accent* headline' };
    const row = mount(HeadlineRow, { props: { headline, offset: 3600 } });
    await row.get('input:not(.time)').setValue('New *words*');
    await row.get('input:not(.time)').trigger('keydown', { key: 'Enter' });
    await row.get('button[title="Set time to the playhead"]').trigger('click');
    expect(row.emitted('update-text')).toEqual([['New *words*']]);
    expect(row.emitted('add-after')).toHaveLength(1);
    expect(row.emitted('set-playhead')).toHaveLength(1);
    expect(row.emitted('select')).toBeUndefined();
    expect(headline.text).toBe('An *accent* headline');
    row.unmount();
  });
  it('renders duration warnings, shared-size indicator and selection', async () => {
    const row = mount(HeadlineRow, { props: {
      headline: { id: 1, t: 0, text: 'A headline' }, offset: 3600, duration: 2,
      setsTextSize: true, selected: true,
    } });
    expect(row.classes()).toContain('sel');
    expect(row.findComponent(DurationBadge).text()).toBe('Length 0:02');
    expect(row.findComponent(DurationBadge).classes()).toContain('warn');
    expect(row.findComponent(DurationBadge).attributes('title')).toContain('Short');
    expect(row.get('input:not(.time)').attributes('title')).toContain('sets the shared text size');
    expect(row.find('.mini').exists()).toBe(false);
    await row.setProps({ duration: 30, setsTextSize: false });
    expect(row.findComponent(DurationBadge).attributes('title')).toContain('Long');
    expect(row.get('input:not(.time)').attributes('title')).not.toContain('sets the shared text size');
    expect(row.findComponent(DurationBadge).classes()).toContain('warn');
    await row.setProps({ duration: 3 });
    expect(row.findComponent(DurationBadge).classes()).not.toContain('warn');
    await row.setProps({ duration: 25 });
    expect(row.findComponent(DurationBadge).classes()).not.toContain('warn');
    await row.setProps({ duration: 1.5 });
    expect(row.findComponent(DurationBadge).text()).toBe('Length 0:01.5');
    expect(row.findComponent(DurationBadge).classes()).toContain('warn');
    await row.setProps({ duration: -1 });
    expect(row.findComponent(DurationBadge).text()).toBe('Past end');
    expect(row.get('.meta').text()).not.toContain('short');
    await row.setProps({ duration: null });
    expect(row.findComponent(DurationBadge).exists()).toBe(false);
    row.unmount();
  });
  it('calculates durations and forwards the affected headline', async () => {
    const state = fromJSON({ ...DEFAULT, headlines: [[0, 'First'], [10, 'Last']], headlines_end: 12 });
    const editor = mount(HeadlineEditor, { props: {
      headlines: state.headlines, end: state.headlines_end, offset: 3600, textSizeIndex: 1,
    } });
    const rows = editor.findAll('.row');
    expect(rows[0].get('.meta').text()).toContain('Length 0:10');
    expect(rows[1].get('.meta').text()).toContain('Length 0:02');
    expect(rows[1].findComponent(DurationBadge).attributes('title')).toContain('Short');
    await rows[1].get('input:not(.time)').trigger('keydown', { key: 'Enter' });
    await rows[1].get('button[title="Delete"]').trigger('click');
    expect(editor.emitted('add-headline')).toEqual([[state.headlines[1]]]);
    expect(editor.emitted('delete-headline')).toEqual([[state.headlines[1]]]);
    await editor.get('.add-headline').trigger('click');
    expect(editor.emitted('add-headline').at(-1)).toEqual([]);
    editor.unmount();
  });
});
