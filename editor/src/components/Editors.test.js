import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChapterEditor from './ChapterEditor.vue';
import ChapterRow from './ChapterRow.vue';
import DurationBadge from './DurationBadge.vue';
import HeadlineEditor from './HeadlineEditor.vue';
import HeadlineRow from './HeadlineRow.vue';
import { DEFAULT, fromJSON } from '../timing.js';

describe('chapter components', () => {
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
    expect(row.emitted('select')).toBeUndefined();
    expect(row.emitted('update-time')).toEqual([[30]]);
    expect(chapter).toEqual({ id: 1, t: 0, ch: 1 });
    expect(row.props('title')).toBe('Intro');
    row.unmount();
  });
  it('does not seek when deleting a row', async () => {
    const row = mount(ChapterRow, { props: { chapter: { id: 1, t: 0, ch: 1 }, title: 'Intro', offset: 3600, duration: 30 } });
    await row.get('button').trigger('click');
    expect(row.emitted('delete')).toHaveLength(1);
    expect(row.emitted('select')).toBeUndefined();
    row.unmount();
  });
  it('forwards chapter identities and metadata edits from the section', async () => {
    const state = fromJSON(DEFAULT);
    const editor = mount(ChapterEditor, { props: {
      chapters: state.chapters, starts: state.chapter_starts, title: state.title,
      product: state.product_name, offset: 3600, end: 195,
    } });
    await editor.get('#chapters input[data-chapter="1"]').setValue('Edited directly');
    await editor.get('#productIn').setValue('New product');
    await editor.get('#titleIn').setValue('New video title');
    await editor.get('#chapters .time').setValue('0:20');
    await editor.get('#addChapter').trigger('click');
    await editor.get('#chapters .crow button').trigger('click');
    expect(editor.emitted('update-chapter-title')).toEqual([[1, 'Edited directly']]);
    expect(editor.emitted('delete-chapter')).toEqual([[1]]);
    expect(editor.emitted('update-metadata')).toEqual([['product_name', 'New product'], ['title', 'New video title']]);
    expect(editor.emitted('update-time')[0]).toEqual([state.chapter_starts[0], 20]);
    expect(editor.emitted('add-chapter')).toHaveLength(1);
    expect(editor.find('#addChapterSwitch').exists()).toBe(false);
    expect(editor.find('#names').exists()).toBe(false);
    expect(state.chapters[0]).toBe(DEFAULT.chapters[0]);
    editor.unmount();
  });
  it('shows a segment length rather than duplicating the starting timecode', async () => {
    const row = mount(ChapterRow, { props: {
      chapter: { id: 1, t: 15, ch: 1 }, title: 'Intro', offset: 3600, duration: 10.5,
    } });
    expect(row.get('.time').element.value).toBe('0:15');
    expect(row.get('.time').attributes('title')).toBe('01:00:15');
    expect(row.get('.chapter-duration').text()).toBe('Length 0:10.5');
    expect(row.findComponent(DurationBadge).props('duration')).toBe(10.5);
    await row.setProps({ duration: 0 });
    expect(row.get('.chapter-duration').text()).toBe('Length 0:00');
    await row.setProps({ duration: -5 });
    expect(row.get('.chapter-duration').text()).toBe('Past end');
    expect(row.get('.chapter-duration').classes()).toContain('warn');
    row.unmount();
  });
  it('updates chapter lengths for time edits and preview end changes', async () => {
    const starts = [{ id: 1, t: 0, ch: 1 }, { id: 2, t: 30, ch: 2 }, { id: 3, t: 45, ch: 3 }];
    const editor = mount(ChapterEditor, { props: {
      chapters: ['Intro', 'Details', 'Ending'], starts, title: 'Video', product: 'Product', offset: 3600, end: 75,
    } });
    const lengths = () => editor.findAll('.chapter-duration').map(badge => badge.text());
    expect(lengths()).toEqual(['Length 0:30', 'Length 0:15', 'Length 0:30']);
    await editor.setProps({ starts: [starts[0], { ...starts[1], t: 10 }, starts[2]] });
    expect(lengths()).toEqual(['Length 0:10', 'Length 0:35', 'Length 0:30']);
    await editor.setProps({ end: 60 });
    expect(lengths()).toEqual(['Length 0:10', 'Length 0:35', 'Length 0:15']);
    await editor.setProps({ end: 35 });
    expect(lengths()).toEqual(['Length 0:10', 'Length 0:25', 'Past end']);
    await editor.setProps({ starts: [{ ...starts[0], t: 0 }, { ...starts[1], t: 0 }] });
    expect(lengths()).toEqual(['Length 0:00', 'Length 0:35']);
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
    expect(row.get('.meta').text()).toContain('short');
    expect(row.get('.meta').text()).toContain('sets text size');
    await row.setProps({ duration: 30, setsTextSize: false });
    expect(row.get('.meta').text()).toContain('long');
    expect(row.get('.meta').text()).not.toContain('sets text size');
    expect(row.findComponent(DurationBadge).classes()).not.toContain('warn');
    await row.setProps({ duration: 3 });
    expect(row.get('.meta').text()).not.toContain('short');
    await row.setProps({ duration: 25 });
    expect(row.get('.meta').text()).not.toContain('long');
    await row.setProps({ duration: 1.5 });
    expect(row.findComponent(DurationBadge).text()).toBe('Length 0:01.5');
    expect(row.get('.meta').text()).toContain('short');
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
      headlines: state.headlines, end: state.headlines_end, wipe: 0.8, offset: 3600, textSizeIndex: 1,
    } });
    const rows = editor.findAll('.row');
    expect(rows[0].get('.meta').text()).toContain('Length 0:10');
    expect(rows[1].get('.meta').text()).toContain('Length 0:02');
    expect(rows[1].get('.meta').text()).toContain('short');
    await rows[1].get('input:not(.time)').trigger('keydown', { key: 'Enter' });
    await rows[1].get('button[title="Delete"]').trigger('click');
    expect(editor.emitted('add-headline')).toEqual([[state.headlines[1]]]);
    expect(editor.emitted('delete-headline')).toEqual([[state.headlines[1]]]);
    await editor.get('#addHeadline').trigger('click');
    expect(editor.emitted('add-headline').at(-1)).toEqual([]);
    editor.unmount();
  });
});
