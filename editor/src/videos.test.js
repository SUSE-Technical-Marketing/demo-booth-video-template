import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';
import Preview from './components/Preview.vue';
import { chaptersCovered, clipAt } from './videos.js';
import { downloadJSON, rememberHandle } from './fileAccess.js';

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
  async function importProject(project) {
    const input = wrapper.get('header input[type=file]');
    Object.defineProperty(input.element, 'files', {
      value: [{ name: 'project.json', text: async () => JSON.stringify(project) }], configurable: true,
    });
    await input.trigger('change');
    await flushPromises();
  }
  async function pointer(handle, type, clientX = 0) {
    handle.element.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX }));
    await wrapper.vm.$nextTick();
  }
  it('persists source trims, paths, placements and FPS and restores missing media without losing timing', async () => {
    await addFiles('a.mp4', 'b.mp4');
    await wrapper.get('#settings-tab').trigger('click');
    const row = wrapper.findAll('#vlist .vrow')[0];
    await row.get('[aria-label="Source in"]').setValue('5');
    await row.get('[aria-label="Source out"]').setValue('15');
    await row.get('[aria-label="Media path"]').setValue('media/a.mp4');
    await wrapper.get('#outputFPS').setValue('30000/1001');
    await wrapper.get('#scrub').setValue('5');
    expect(wrapper.findAll('#content video')[0].element.currentTime).toBe(10);
    await wrapper.get('#scrub').setValue('20');
    expect(wrapper.get('#content').text()).toBe('no video at this time');
    await wrapper.get('#btnDownload').trigger('click');
    const project = JSON.parse(downloadJSON.mock.calls[0][0]);
    expect(project.output.fps).toBe('30000/1001');
    expect(project.media[0].path).toBe('media/a.mp4');
    expect(project.clips[0]).toMatchObject({ start: 0, source_in: 5, source_out: 15 });
    expect(project.clips[1].start).toBe(40);
    expect(JSON.stringify(project)).not.toContain('blob:');
    await importProject(project);
    expect(wrapper.findAll('#vlist .vrow')).toHaveLength(2);
    expect(wrapper.findAll('#content video')).toHaveLength(0);
    await wrapper.get('#scrub').setValue('2');
    expect(wrapper.get('#content').text()).toContain('Missing media: a.mp4');
    expect(wrapper.get('#durChip').text()).toBe('to 1:20');
    await wrapper.findAll('#vlist .vrow')[0].get('.relink-media').trigger('click');
    const input = wrapper.get('#relinkFile');
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'a.mp4')], configurable: true });
    await input.trigger('change');
    await new Promise(resolve => setTimeout(resolve, 20));
    await flushPromises();
    expect(wrapper.findAll('#content video')).toHaveLength(1);
    expect(wrapper.get('#content video').element.currentTime).toBe(7);
    expect(wrapper.findAll('#vlist .vrow')[0].get('.clip-path input').element.value).toBe('media/a.mp4');
  });
  it('rejects overlaps, out-of-source trims and invalid paths without changing the project', async () => {
    await addFiles('a.mp4', 'b.mp4');
    const [first, second] = wrapper.findAll('#vlist .vrow');
    await second.get('[aria-label="Video start time"]').setValue('30');
    expect(wrapper.get('#toast').text()).toContain('overlap');
    expect(second.get('[aria-label="Video start time"]').element.value).toBe('0:40');
    await first.get('[aria-label="Source out"]').setValue('41');
    expect(wrapper.get('#toast').text()).toContain('exceeds the video duration');
    expect(first.get('[aria-label="Source out"]').element.value).toBe('0:40');
    await first.get('[aria-label="Media path"]').setValue('/absolute/a.mp4');
    expect(wrapper.get('#toast').text()).toContain('relative media path');
    expect(first.get('[aria-label="Media path"]').element.value).toBe('a.mp4');
  });
  it('undoes persisted clip removal and source edits', async () => {
    await addFiles('a.mp4');
    await wrapper.get('#vlist [aria-label="Source in"]').setValue('5');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.get('#vlist [aria-label="Source in"]').element.value).toBe('0:00');
    await wrapper.get('#vlist .vrow button').trigger('click');
    expect(wrapper.findAll('#vlist .vrow')).toHaveLength(0);
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.findAll('#content video')).toHaveLength(1);
  });
  it('trims a clip start without moving its end or other timings and undoes the entire drag', async () => {
    await addFiles('a.mp4', 'b.mp4');
    await wrapper.get('#btnDownload').trigger('click');
    const before = JSON.parse(downloadJSON.mock.calls.at(-1)[0]);
    const handle = wrapper.get('[aria-label="Trim video start: a.mp4"]'), timeline = wrapper.get('#tl');
    handle.element.setPointerCapture = vi.fn();
    vi.spyOn(timeline.element, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 800 });
    await pointer(handle, 'pointerdown');
    await pointer(handle, 'pointermove', 200);
    await pointer(handle, 'pointermove', 300);
    await pointer(handle, 'pointerup');
    expect(wrapper.get('#settings-tab').attributes('aria-selected')).toBe('true');
    expect(wrapper.findAll('#vlist [aria-label="Source in"]')[0].element.value).toBe('0:30');
    expect(wrapper.get('#content video').element.currentTime).toBe(30);
    await wrapper.get('#btnDownload').trigger('click');
    const after = JSON.parse(downloadJSON.mock.calls.at(-1)[0]);
    expect(after.clips[0]).toMatchObject({ start: 30, source_in: 30, source_out: 40 });
    expect(after.clips[1]).toEqual(before.clips[1]);
    expect(after.timing).toEqual(before.timing);
    await wrapper.get('#btnUndo').trigger('click');
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls.at(-1)[0])).toEqual(before);
  });
  it('keeps the timeline scale fixed while trimming the final clip and restores it on release', async () => {
    await addFiles('a.mp4', 'b.mp4');
    const handle = wrapper.get('[aria-label="Trim video end: b.mp4"]'), timeline = wrapper.get('#tl');
    handle.element.setPointerCapture = vi.fn();
    vi.spyOn(timeline.element, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 800 });
    await pointer(handle, 'pointerdown');
    await pointer(handle, 'pointermove', 600);
    expect(wrapper.get('#durChip').text()).toBe('to 1:00');
    expect(parseFloat(handle.element.style.left)).toBeCloseTo(75);
    await pointer(handle, 'pointermove', 500);
    expect(wrapper.get('#durChip').text()).toBe('to 0:50');
    expect(parseFloat(handle.element.style.left)).toBeCloseTo(62.5);
    await pointer(handle, 'pointerup');
    expect(handle.element.style.left).toBe('100%');
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls.at(-1)[0]).clips[1]).toMatchObject({ start: 40, source_in: 0, source_out: 10 });
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.get('#durChip').text()).toBe('to 1:20');
  });
  it('allows extending the final clip with pointer capture past the old timeline end', async () => {
    await addFiles('a.mp4');
    await wrapper.get('#vlist [aria-label="Source out"]').setValue('20');
    const handle = wrapper.get('.clip-handle.end'), timeline = wrapper.get('#tl');
    handle.element.setPointerCapture = vi.fn();
    vi.spyOn(timeline.element, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 800 });
    await pointer(handle, 'pointerdown');
    await pointer(handle, 'pointermove', 1200);
    expect(wrapper.get('#durChip').text()).toBe('to 0:30');
    await handle.trigger('lostpointercapture', { pointerId: 1 });
    expect(handle.element.style.left).toBe('100%');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.get('#durChip').text()).toBe('to 0:20');
  });
  it('clamps keyboard trims between clips and persists source edits', async () => {
    await addFiles('a.mp4', 'b.mp4');
    await wrapper.get('#vlist [aria-label="Source out"]').setValue('39.8');
    await wrapper.get('[aria-label="Trim video end: a.mp4"]').trigger('keydown', { key: 'ArrowRight', shiftKey: true });
    await wrapper.get('[aria-label="Trim video start: b.mp4"]').trigger('keydown', { key: 'ArrowLeft', shiftKey: true });
    await wrapper.get('#btnDownload').trigger('click');
    const project = JSON.parse(downloadJSON.mock.calls.at(-1)[0]);
    expect(project.clips[0]).toMatchObject({ start: 0, source_in: 0, source_out: 40 });
    expect(project.clips[1]).toMatchObject({ start: 40, source_in: 0, source_out: 40 });
  });
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
