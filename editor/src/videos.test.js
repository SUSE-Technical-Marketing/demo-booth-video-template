import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';
import Preview from './components/Preview.vue';
import { chaptersCovered, clipAt } from './videos.js';
import { rememberHandle } from './fileAccess.js';

vi.mock('./fileAccess.js', () => ({
  downloadJSON: vi.fn(), rememberHandle: vi.fn().mockResolvedValue(),
  rememberedHandle: vi.fn().mockResolvedValue(null), pickerOptions: {},
}));

const sw = [{ id: 1, t: 0, ch: 1 }, { id: 2, t: 30, ch: 2 }, { id: 3, t: 60, ch: 3 }];
describe('clip helpers', () => {
  it('finds the clip under the playhead', () => {
    const clips = [{ start: 0, dur: 10 }, { start: 20, dur: 10 }];
    expect(clipAt(clips, 5)).toBe(clips[0]);
    expect(clipAt(clips, 15)).toBeUndefined();
    expect(clipAt(clips, 20)).toBe(clips[1]);
  });
  it('lists the chapters a clip overlaps', () => {
    expect(chaptersCovered({ start: 0, dur: 30 }, sw)).toEqual([1]);
    expect(chaptersCovered({ start: 0, dur: 70 }, sw)).toEqual([1, 2, 3]);
    expect(chaptersCovered({ start: 30, dur: 40 }, sw)).toEqual([2, 3]);
  });
});

describe('videos and New in the editor', () => {
  let wrapper;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: t => ({ width: t.length * 14 }) });
    Element.prototype.scrollIntoView = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn();
    // every "video file" reports a 40 s length
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(tag => {
      const el = create(tag);
      if (tag === 'video') Object.defineProperty(el, 'src', { set() {
        Object.defineProperty(el, 'duration', { value: 40 }); setTimeout(() => el.onloadedmetadata?.(), 0); } });
      return el;
    });
    wrapper = mount(App, { attachTo: document.body });
  });
  afterEach(() => { wrapper.unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  async function addFiles(...names) {
    const input = wrapper.get('#videoFile');
    Object.defineProperty(input.element, 'files', { value: names.map(name => new File(['x'], name)), configurable: true });
    await input.trigger('change');
    await new Promise(r => setTimeout(r, 20)); await flushPromises();
  }
  it('preserves loaded video elements and object URLs when switching sidebar tabs', async () => {
    await wrapper.get('#settings-tab').trigger('click');
    await addFiles('a.mp4');
    const video = wrapper.get('#content video').element;
    expect(wrapper.get('#vlist').isVisible()).toBe(true);
    await wrapper.get('#chapters-tab').trigger('click');
    expect(wrapper.get('#vlist').isVisible()).toBe(false);
    expect(wrapper.get('#chapters').isVisible()).toBe(true);
    await wrapper.get('#settings-tab').trigger('click');
    expect(wrapper.get('#vlist .name').text()).toBe('a.mp4');
    expect(wrapper.get('#content video').element).toBe(video);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
  it('adds several videos in order, one after another, and shows them on the timeline', async () => {
    await addFiles('a.mp4', 'b.mp4');
    const rows = wrapper.findAll('#vlist .vrow');
    expect(rows.map(r => r.get('.name').text())).toEqual(['a.mp4', 'b.mp4']);
    expect(rows[1].get('input.time').element.value).toBe('0:40');
    expect(wrapper.findAll('#tl .vclip')).toHaveLength(2);
    expect(wrapper.get('#durChip').text()).toBe('to 1:20');
    const lengths = [];
    for (const chapter of wrapper.findAll('.chapter-count')) {
      await chapter.trigger('click');
      lengths.push(wrapper.get('.chapter-duration').text());
    }
    expect(lengths).toEqual(['Length 0:30', 'Length 0:30', 'Length 0:20', 'Past end', 'Past end', 'Past end']);
  });
  it('keeps loaded video duration while capping chapter and headline bands at the configured end', async () => {
    await wrapper.get('#btnNew').trigger('click');
    await addFiles('a.mp4');
    await wrapper.get('#chapterEndAt').setValue('0:20');
    expect(wrapper.get('#durChip').text()).toBe('to 0:40');
    expect(wrapper.get('.chapter-duration').text()).toBe('Length 0:20');
    expect(parseFloat(wrapper.get('#tl .band').element.style.width)).toBe(50);
    expect(parseFloat(wrapper.get('#tl .headline-band').element.style.width)).toBe(50);
    await wrapper.get('#scrub').setValue('21');
    expect(wrapper.get('#hl').text()).toBe('');
    expect(wrapper.get('#content video').element.currentTime).toBe(21);
    await wrapper.get('#chapterEndAt').setValue('0:50');
    expect(wrapper.get('.chapter-duration').text()).toBe('Length 0:40');
    expect(wrapper.get('#durChip').text()).toBe('to 0:40');
  });
  it('integrates local clips with the sidebar, fitted preview and docked playback controls', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    await addFiles('a.mp4', 'b.mp4');
    expect(wrapper.findAll('.editor-panel #vlist .vrow')).toHaveLength(2);
    expect(wrapper.findAll('.preview-canvas #content video')).toHaveLength(2);
    expect(wrapper.findAll('.timeline-dock .vclip')).toHaveLength(2);
    await wrapper.get('.timeline-dock #scrub').setValue('55');
    const videos = wrapper.findAll('#content video');
    expect(videos[0].element.style.display).toBe('none');
    expect(videos[1].element.style.display).not.toBe('none');
    expect(videos[1].element.currentTime).toBe(15);
    const preview = wrapper.findComponent(Preview);
    await wrapper.get('.timeline-dock #btnPlay').trigger('click');
    expect(preview.props('playing')).toBe(true);
    expect(videos[1].element.play).toHaveBeenCalled();
    await wrapper.get('.timeline-dock #btnPlay').trigger('click');
    expect(preview.props('playing')).toBe(false);
  });
  it('moves a clip with its start time and by snapping to a chapter', async () => {
    await addFiles('a.mp4');
    const row = wrapper.get('#vlist .vrow');
    await row.get('input.time').setValue('1:00'); await row.get('input.time').trigger('change');
    expect(row.get('input.time').element.value).toBe('1:00');
    const select = row.get('select');
    await select.setValue(String(select.findAll('option')[2].element.value)); // second chapter (30 s)
    expect(wrapper.get('#vlist .vrow input.time').element.value).toBe('0:30');
  });
  it('removes a clip and falls back to the placeholder', async () => {
    await addFiles('a.mp4');
    await wrapper.get('#vlist .vrow button').trigger('click');
    expect(wrapper.findAll('#vlist .vrow')).toHaveLength(0);
    expect(wrapper.get('#content').text()).toBe('your video here');
  });
  it('New starts a blank video, clears clips, and forgets the linked file', async () => {
    await addFiles('a.mp4');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await wrapper.get('.headline-list input:not(.time)').setValue('Changed');   // makes it dirty
    await wrapper.get('#btnNew').trigger('click'); await flushPromises();
    expect(window.confirm).toHaveBeenCalled();
    expect(wrapper.findAll('.headline-list .row')).toHaveLength(1);
    expect(wrapper.findAll('#stage .pill')).toHaveLength(1);
    expect(wrapper.findAll('#vlist .vrow')).toHaveLength(0);
    expect(rememberHandle).toHaveBeenCalledWith(null);
    await wrapper.get('#btnUndo').trigger('click');                         // undo brings the previous video back
    expect(wrapper.findAll('.headline-list .row')).toHaveLength(2);
  });
  it('New keeps everything if the unsaved-changes prompt is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await wrapper.get('.headline-list input:not(.time)').setValue('Changed');
    await wrapper.get('#btnNew').trigger('click'); await flushPromises();
    expect(wrapper.findAll('.headline-list .row')).toHaveLength(2);
  });
  it('renames a chapter directly from its row', async () => {
    const input = wrapper.get('#chapters input[data-chapter="1"]');
    await input.setValue('Renamed');
    expect(wrapper.get('#stage .pill').text()).toBe('Renamed');
    expect(input.element.value).toBe('Renamed');
    await input.setValue('Edited directly');
    expect(wrapper.get('#stage .pill').text()).toBe('Edited directly');
  });
});
