import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChapterEditor from './ChapterEditor.vue';
import ChapterRow from './ChapterRow.vue';
import HeadlineEditor from './HeadlineEditor.vue';
import HeadlineRow from './HeadlineRow.vue';
import { DEFAULT, fromJSON } from '../timing.js';

describe('chapter components', () => {
  it('emits row edits without mutating chapter props', async () => {
    const chapter = { id: 1, t: 0, ch: 1 }, chapters = ['Intro', 'Details'];
    const row = mount(ChapterRow, { props: { chapter, chapters, offset: 3600 } });
    await row.get('.time').trigger('focus');
    await row.get('select').setValue('2');
    await row.get('.time').setValue('0:30');
    expect(row.emitted('begin-edit')).toHaveLength(1);
    expect(row.emitted('choose-chapter')).toEqual([[2]]);
    expect(row.emitted('update-time')).toEqual([[30]]);
    expect(chapter).toEqual({ id: 1, t: 0, ch: 1 });
    expect(chapters).toEqual(['Intro', 'Details']);
    row.unmount();
  });
  it('does not seek when deleting a row', async () => {
    const row = mount(ChapterRow, { props: { chapter: { id: 1, t: 0, ch: 1 }, chapters: ['Intro'], offset: 3600 } });
    await row.get('button').trigger('click');
    expect(row.emitted('delete')).toHaveLength(1);
    expect(row.emitted('select')).toBeUndefined();
    row.unmount();
  });
  it('forwards chapter identities and metadata edits from the section', async () => {
    const state = fromJSON(DEFAULT);
    const editor = mount(ChapterEditor, { props: {
      chapters: state.chapters, switches: state.chapter_starts, title: state.title,
      product: state.product_name, offset: 3600,
    } });
    await editor.get('#names input[data-chapter="1"]').setValue('Edited in names');
    await editor.get('#productIn').setValue('New product');
    await editor.get('#titleIn').setValue('New video title');
    await editor.get('#chapters .time').setValue('0:20');
    await editor.get('#addChapter').trigger('click');
    await editor.get('#addChapterSwitch').trigger('click');
    expect(editor.emitted('update-chapter-title')).toEqual([[1, 'Edited in names']]);
    expect(editor.emitted('update-metadata')).toEqual([['product_name', 'New product'], ['title', 'New video title']]);
    expect(editor.emitted('update-time')[0]).toEqual([state.chapter_starts[0], 20]);
    expect(editor.emitted('add-chapter')).toHaveLength(1);
    expect(editor.emitted('add-switch')).toHaveLength(1);
    expect(state.chapters[0]).toBe(DEFAULT.chapters[0]);
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
    expect(row.get('.meta').text()).toContain('short');
    expect(row.get('.meta').text()).toContain('sets text size');
    await row.setProps({ duration: 30, setsTextSize: false });
    expect(row.get('.meta').text()).toContain('long');
    expect(row.get('.meta').text()).not.toContain('sets text size');
    row.unmount();
  });
  it('calculates durations and forwards the affected headline', async () => {
    const state = fromJSON({ ...DEFAULT, headlines: [[0, 'First'], [10, 'Last']], headlines_end: 12 });
    const editor = mount(HeadlineEditor, { props: {
      headlines: state.headlines, end: state.headlines_end, wipe: 0.8, offset: 3600, textSizeIndex: 1,
    } });
    const rows = editor.findAll('.row');
    expect(rows[0].get('.meta').text()).toContain('10 s');
    expect(rows[1].get('.meta').text()).toContain('2 sshort');
    await rows[1].get('input:not(.time)').trigger('keydown', { key: 'Enter' });
    await rows[1].get('button[title="Delete"]').trigger('click');
    expect(editor.emitted('add-headline')).toEqual([[state.headlines[1]]]);
    expect(editor.emitted('delete-headline')).toEqual([[state.headlines[1]]]);
    await editor.get('#addHeadline').trigger('click');
    expect(editor.emitted('add-headline').at(-1)).toEqual([]);
    editor.unmount();
  });
});
