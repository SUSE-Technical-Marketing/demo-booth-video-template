import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';
import Preview from './components/Preview.vue';
import { downloadJSON } from './fileAccess.js';
import { createProject } from './project.js';
import { DEFAULT } from './timing.js';

vi.mock('./fileAccess.js', () => ({
  downloadJSON: vi.fn(), rememberHandle: vi.fn().mockResolvedValue(),
  rememberedHandle: vi.fn().mockResolvedValue(null), pickerOptions: {},
}));

describe('freeze frame and cut section tools', () => {
  let wrapper;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('showDirectoryPicker', undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: t => ({ width: t.length * 14 }) });
    Element.prototype.scrollIntoView = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn();
    try { localStorage.removeItem('timeline_show_videos'); } catch { /* fine */ }
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(tag => {      // every video file is 40 s long
      const el = create(tag);
      if (tag === 'video') Object.defineProperty(el, 'src', { set() {
        Object.defineProperty(el, 'duration', { value: 40 }); setTimeout(() => el.onloadedmetadata?.(), 0); } });
      return el;
    });
    wrapper = mount(App, { attachTo: document.body });
  });
  afterEach(() => { wrapper.unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  async function addVideo(...names) {
    const input = wrapper.get('#videoFile');
    Object.defineProperty(input.element, 'files', { value: names.map(name => new File(['x'], name)), configurable: true });
    await input.trigger('change');
    await new Promise(r => setTimeout(r, 20)); await flushPromises();
  }
  const project = async () => { await wrapper.get('#btnDownload').trigger('click'); return JSON.parse(downloadJSON.mock.calls.at(-1)[0]); };
  const clips = async () => (await project()).clips.map(c => [c.start, c.source_in, c.source_out, !!c.freeze]);
  const chapterStarts = async () => (await project()).timing.chapters.map(c => c.start);
  const seekTo = async time => { await wrapper.get('#scrub').setValue(String(time)); };
  async function freeze(at, length, mode = 'insert') {
    await seekTo(at);
    await wrapper.get('#btnFreeze').trigger('click');
    await wrapper.get('#freezeLength').setValue(String(length));
    if (mode === 'replace') await wrapper.get('input[value=replace]').setValue();
    await wrapper.get('#freezeApply').trigger('click');
    await flushPromises();
  }

  it('freezes the frame at the playhead and inserts the hold, pushing the rest of the video and the chapters later', async () => {
    await addVideo('a.mp4');
    expect(await chapterStarts()).toEqual([0, 30, 60, 90, 120, 150]);
    await seekTo(10);
    await wrapper.get('#btnFreeze').trigger('click');
    expect(wrapper.get('.edit-strip').text()).toContain('a.mp4');
    await wrapper.get('#freezeLength').setValue('4');
    await wrapper.get('#freezeApply').trigger('click');
    await flushPromises();
    expect(wrapper.get('#toast').text()).toContain('Froze the frame at 0:10');
    expect(wrapper.find('.edit-strip').exists()).toBe(false);                      // the tool closes when applied
    expect(await clips()).toEqual([[0, 0, 10, false], [10, 10, 14, true], [14, 10, 40, false]]);
    expect(await chapterStarts()).toEqual([0, 34, 64, 94, 124, 154]);
    expect(wrapper.findAll('.vclip').map(c => c.classes().includes('freeze'))).toEqual([false, true, false]);
    expect(wrapper.get('#durChip').text()).toBe('to 0:44');
  });

  it('replace mode covers the next seconds of video and moves nothing', async () => {
    await addVideo('a.mp4');
    await freeze(10, 4, 'replace');
    expect(await clips()).toEqual([[0, 0, 10, false], [10, 10, 14, true], [14, 14, 40, false]]);
    expect(await chapterStarts()).toEqual([0, 30, 60, 90, 120, 150]);
    expect(wrapper.get('#durChip').text()).toBe('to 0:40');
  });

  it('can leave the chapters alone and is one undo step', async () => {
    await addVideo('a.mp4');
    await seekTo(10);
    await wrapper.get('#btnFreeze').trigger('click');
    await wrapper.get('.strip-check input').setValue(false);
    await wrapper.get('#freezeApply').trigger('click');
    await flushPromises();
    expect(await chapterStarts()).toEqual([0, 30, 60, 90, 120, 150]);
    expect((await clips()).length).toBe(3);
    await wrapper.get('#btnUndo').trigger('click');
    expect(await clips()).toEqual([[0, 0, 40, false]]);
  });

  it('explains when the playhead is not on a video or is already on a freeze frame', async () => {
    await addVideo('a.mp4');
    await seekTo(10);
    await wrapper.get('#btnFreeze').trigger('click');
    await wrapper.get('#freezeApply').trigger('click');
    await flushPromises();
    await seekTo(11);
    await wrapper.get('#btnFreeze').trigger('click');
    expect(wrapper.get('#freezeProblem').text()).toContain('already a freeze frame');
    expect(wrapper.find('#freezeApply').exists()).toBe(false);
    await wrapper.get('.strip-close').trigger('click');
    expect(wrapper.find('.edit-strip').exists()).toBe(false);
    expect(wrapper.get('#btnFreeze').attributes('disabled')).toBeUndefined();
  });

  it('the tools need a video, and a second click on the button closes the tool', async () => {
    expect(wrapper.get('#btnFreeze').attributes('disabled')).toBeDefined();
    expect(wrapper.get('#btnCut').attributes('disabled')).toBeDefined();
    await addVideo('a.mp4');
    await wrapper.get('#btnCut').trigger('click');
    expect(wrapper.find('.edit-strip').exists()).toBe(true);
    await wrapper.get('#btnCut').trigger('click');
    expect(wrapper.find('.edit-strip').exists()).toBe(false);
  });

  it('changing a freeze length from the Videos list ripples everything after it', async () => {
    await addVideo('a.mp4');
    await freeze(10, 4);
    await wrapper.get('#settings-tab').trigger('click');
    const row = wrapper.findAll('#vlist .vrow').find(r => r.classes().includes('freeze'));
    expect(row.text()).toContain('Freeze frame');
    await row.get('[aria-label="Freeze length"]').setValue('7');
    expect(await clips()).toEqual([[0, 0, 10, false], [10, 10, 17, true], [17, 10, 40, false]]);
    expect(await chapterStarts()).toEqual([0, 37, 67, 97, 127, 157]);
    await wrapper.get('#btnUndo').trigger('click');
    expect(await clips()).toEqual([[0, 0, 10, false], [10, 10, 14, true], [14, 10, 40, false]]);
  });

  it('dragging the right edge of a freeze changes its length (keyboard on the same handle)', async () => {
    await addVideo('a.mp4');
    await freeze(10, 4);
    const handles = wrapper.findAll('[data-handle="clip-end"]');
    expect(wrapper.findAll('[data-handle="clip-start"]')).toHaveLength(2);        // the hold has no start handle
    expect(handles).toHaveLength(3);
    const hold = wrapper.findAll('.clip-handle.end')[1];
    expect(hold.attributes('aria-label')).toContain('freeze frame length');
    await hold.trigger('keydown', { key: 'ArrowRight', shiftKey: true });
    expect(await clips()).toEqual([[0, 0, 10, false], [10, 10, 15, true], [15, 10, 40, false]]);
    await wrapper.get('#btnUndo').trigger('click');
    expect((await clips())[1]).toEqual([10, 10, 14, true]);
  });

  it('cut section removes a range from the middle of a clip and closes the gap, with timing following', async () => {
    await addVideo('a.mp4');
    await seekTo(10);
    await wrapper.get('#btnCut').trigger('click');
    expect(wrapper.find('.cut-range').exists()).toBe(true);
    expect(wrapper.get('#cutFrom').element.value).toBe('0:10');                    // starts at the playhead
    await wrapper.get('#cutTo').setValue('0:17');
    expect(wrapper.get('#cutSpan').text()).toContain('0:07');
    await wrapper.get('#cutApply').trigger('click');
    await flushPromises();
    expect(wrapper.get('#toast').text()).toContain('Removed 0:07');
    expect(wrapper.find('.cut-range').exists()).toBe(false);
    expect(wrapper.get('#durChip').text()).toBe('to 0:33');
    expect(await clips()).toEqual([[0, 0, 10, false], [10, 17, 40, false]]);
    expect(await chapterStarts()).toEqual([0, 23, 53, 83, 113, 143]);
    await wrapper.get('#btnUndo').trigger('click');
    expect(await clips()).toEqual([[0, 0, 40, false]]);
    expect(await chapterStarts()).toEqual([0, 30, 60, 90, 120, 150]);
  });

  it('the edges of the range can be dragged on the timeline and the fields follow', async () => {
    await addVideo('a.mp4');
    await seekTo(10);
    await wrapper.get('#btnCut').trigger('click');
    await wrapper.get('[data-handle="cut-end"]').trigger('keydown', { key: 'ArrowRight', shiftKey: true });
    expect(wrapper.get('#cutTo').element.value).toBe('0:16');                      // 10 + 5 default, +1
    await wrapper.get('[data-handle="cut-start"]').trigger('keydown', { key: 'ArrowLeft', shiftKey: true });
    expect(wrapper.get('#cutFrom').element.value).toBe('0:09');
    await wrapper.get('#cutFrom').setValue('0:12');
    await wrapper.get('input[aria-label="Cut to"]').setValue('0:12');            // an empty range is turned into a usable one
    expect(wrapper.get('#cutApply').attributes('disabled')).toBeUndefined();
    expect(await clips()).toEqual([[0, 0, 40, false]]);                            // nothing changes until it is applied
  });

  it('can leave chapters and headlines where they are, and "playhead" buttons set the edges', async () => {
    await addVideo('a.mp4');
    await seekTo(8);
    await wrapper.get('#btnCut').trigger('click');
    await seekTo(20);
    await wrapper.findAll('.strip-field button')[1].trigger('click');
    expect(wrapper.get('#cutTo').element.value).toBe('0:20');
    await wrapper.get('.strip-check input').setValue(false);
    await wrapper.get('#cutApply').trigger('click');
    await flushPromises();
    expect(await clips()).toEqual([[0, 0, 8, false], [8, 20, 40, false]]);
    expect(await chapterStarts()).toEqual([0, 30, 60, 90, 120, 150]);
  });

  it('Escape closes the open tool', async () => {
    await addVideo('a.mp4');
    await wrapper.get('#btnCut').trigger('click');
    await wrapper.get('#cutFrom').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('.edit-strip').exists()).toBe(false);
  });
});

describe('the preview holds a freeze frame', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('seeks to the frozen frame and does not play it', async () => {
    const state = { ...createProject(DEFAULT), preview_end: 14 };
    const clips = [
      { id: 'a', name: 'a.mp4', url: 'blob:a', start: 0, dur: 10, source_in: 0, source_out: 10 },
      { id: 'hold', name: 'a.mp4', url: 'blob:a', start: 10, dur: 4, source_in: 7, source_out: 11, freeze: true },
    ];
    const wrapper = mount(Preview, { props: { state, cur: 5, headlinePx: 70, pillPx: 28, productPx: 56, clips, playing: true } });
    await flushPromises();
    HTMLMediaElement.prototype.play.mockClear();
    await wrapper.setProps({ cur: 12 });
    await flushPromises();
    const videos = wrapper.findAll('#content video');
    expect(videos[1].element.currentTime).toBe(7);                                  // the frame to hold, not 7 + 2
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(videos[1].isVisible()).toBe(true);
    wrapper.unmount();
  });
  it('composites two videos, mixes their audio, seeks both and buffers on either source during a dissolve', async () => {
    const state = { ...createProject(DEFAULT), preview_end: 18 };
    const clips = [
      { id: 'a', name: 'a.mp4', url: 'blob:a', start: 0, dur: 10, source_in: 3, source_out: 13 },
      { id: 'b', name: 'b.mp4', url: 'blob:b', start: 8, dur: 10, source_in: 5, source_out: 15,
        transition_in: { type: 'crossfade', duration: 2 } },
    ];
    const wrapper = mount(Preview, { attachTo: document.body, props: { state, cur: 7, headlinePx: 70, pillPx: 28, productPx: 56, clips } });
    await wrapper.setProps({ cur: 9 });
    const videos = wrapper.findAll('#content video');
    expect(videos.map(v => v.isVisible())).toEqual([true, true]);
    expect(videos.map(v => v.element.currentTime)).toEqual([12, 6]);
    expect(videos.map(v => v.element.volume)).toEqual([0.5, 0.5]);
    expect(videos.map(v => v.element.style.opacity)).toEqual(['1', '0.5']);
    expect(videos[1].element.style.zIndex).toBe('2');
    await wrapper.setProps({ playing: true });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    await videos[0].trigger('waiting');
    expect(wrapper.emitted('buffering').at(-1)).toEqual([true]);
    await wrapper.setProps({ cur: 8.5, playing: false, muted: true });
    expect(videos.map(v => v.element.currentTime)).toEqual([11.5, 5.5]);
    expect(videos.map(v => v.element.volume)).toEqual([0.75, 0.25]);
    expect(videos.map(v => v.element.muted)).toEqual([true, true]);
    await wrapper.setProps({ cur: 10 });
    expect(videos[0].element.style.display).toBe('none');
    expect(videos.map(v => v.isVisible())).toEqual([false, true]);
    expect(videos[1].element.volume).toBe(1);
    await wrapper.setProps({ cur: 7, playing: true });
    videos[1].element.currentTime = 5.3;
    await wrapper.setProps({ cur: 8.05 });
    expect(videos[1].element.currentTime).toBeCloseTo(5.05);
    wrapper.unmount();
  });
});
