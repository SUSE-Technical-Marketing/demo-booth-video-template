import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';
import Preview from './components/Preview.vue';
import { chaptersCovered, clipAt } from './videos.js';
import { downloadJSON, rememberHandle, rememberedHandle } from './fileAccess.js';
import projectFixture from '../../tests/fixtures/project.json';

vi.mock('./fileAccess.js', () => ({
  downloadJSON: vi.fn(), rememberHandle: vi.fn().mockResolvedValue(),
  rememberedHandle: vi.fn().mockResolvedValue(null), pickerOptions: {},
}));

const sw = [{ id: 1, t: 0, ch: 1 }, { id: 2, t: 30, ch: 2 }, { id: 3, t: 60, ch: 3 }];
const folderProject = () => ({
  ...structuredClone(projectFixture), media_folder: 'media',
  media: projectFixture.media.map(media => ({ ...media, path: media.path.slice('media/'.length) })),
});
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
  let wrapper, videoLength;
  beforeEach(() => {
    videoLength = 40;
    vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('showDirectoryPicker', undefined);
    rememberedHandle.mockResolvedValue(null);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: t => ({ width: t.length * 14 }) });
    Element.prototype.scrollIntoView = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn();
    // every "video file" reports a 40 s length
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(tag => {
      const el = create(tag);
      if (tag === 'video') Object.defineProperty(el, 'src', { set() {
        Object.defineProperty(el, 'duration', { value: videoLength }); setTimeout(() => el.onloadedmetadata?.(), 0); } });
      return el;
    });
    wrapper = mount(App, { attachTo: document.body });
  });
  afterEach(() => { wrapper.unmount(); delete document.fullscreenElement; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
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
  function nativeFolder(projects = { 'project.json': structuredClone(projectFixture) }) {
    const sources = new Map(projectFixture.media.map(media => [media.path.slice('media/'.length), new File(['video'], media.path.split('/').at(-1))]));
    const manifests = new Map(Object.entries(projects).map(([name, project]) => [name, {
      kind: 'file', name,
      getFile: vi.fn(async () => ({ name, text: async () => JSON.stringify(project) })),
      queryPermission: vi.fn().mockResolvedValue('granted'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
    }]));
    const media = {
      kind: 'directory', name: 'media',
      getFileHandle: vi.fn(async name => {
        if (!sources.has(name)) throw new DOMException('File not found', 'NotFoundError');
        return { getFile: async () => sources.get(name) };
      }),
    };
    const directory = {
      kind: 'directory', name: 'demo',
      async *values() { yield* manifests.values(); yield media; },
      getDirectoryHandle: vi.fn(async name => {
        if (name !== 'media') throw new DOMException('Directory not found', 'NotFoundError');
        return media;
      }),
      queryPermission: vi.fn().mockResolvedValue('granted'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
      resolve: vi.fn(async file => manifests.has(file.name) ? [file.name] : null),
    };
    return { directory, manifests, sources, media };
  }
  async function settleFolder() {
    await flushPromises();
    await new Promise(resolve => setTimeout(resolve, 30));
    await flushPromises();
  }
  async function openNativeFolder(folder) {
    vi.stubGlobal('showDirectoryPicker', vi.fn().mockResolvedValue(folder.directory));
    await wrapper.get('#btnOpenFolder').trigger('click');
    await settleFolder();
  }
  it('opens a project folder and automatically links its relative media without changing the project', async () => {
    const folder = nativeFolder();
    await openNativeFolder(folder);
    expect(window.showDirectoryPicker).toHaveBeenCalledWith({ id: 'video-project', mode: 'readwrite' });
    expect(wrapper.findAll('#content video')).toHaveLength(2);
    expect(wrapper.get('#toast').text()).toContain('linked 2 video source(s)');
    expect(wrapper.get('#status').text()).toBe('saved to project.json');
    expect(rememberHandle).toHaveBeenLastCalledWith({ file: folder.manifests.get('project.json'), directory: folder.directory });
    await wrapper.get('#scrub').setValue('0.6');
    expect(wrapper.findAll('#content video')[0].element.currentTime).toBeCloseTo(0.8);
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls.at(-1)[0])).toEqual(projectFixture);
  });
  it('the export dialog gets the real folder handle (not the folder wrapper) to start its save picker in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, encoders: {} }) })));
    const folder = nativeFolder();
    await openNativeFolder(folder);
    await wrapper.get('#btnExport').trigger('click');
    await flushPromises();
    const startIn = wrapper.findComponent({ name: 'ExportDialog' }).props('startIn');
    expect(startIn.kind).toBe('directory');
    expect(startIn.name).toBe('demo');
    expect(wrapper.findAll('#exportMissing')).toHaveLength(0);                    // linked from the folder: ready to export
  });
  it('opens a configured media folder by combining the base with each relative path', async () => {
    const project = folderProject();
    const folder = nativeFolder({ 'project.json': project });
    await openNativeFolder(folder);
    expect(wrapper.findAll('#content video')).toHaveLength(2);
    expect(wrapper.get('#mediaFolder').element.value).toBe('media');
    expect(folder.directory.getDirectoryHandle.mock.calls.map(([name]) => name)).toEqual(['media', 'media']);
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls.at(-1)[0])).toEqual(project);
  });
  it.each([false, true])('supports directory upload with a configured media-folder base: %s', async configured => {
    const project = configured ? folderProject() : projectFixture;
    const file = new File([JSON.stringify(project)], 'project.json');
    Object.defineProperties(file, {
      webkitRelativePath: { value: 'demo/project.json' },
      text: { value: async () => JSON.stringify(project) },
    });
    const videos = projectFixture.media.map(media => {
      const video = new File(['video'], media.path.split('/').at(-1));
      Object.defineProperty(video, 'webkitRelativePath', { value: `demo/${media.path}` });
      return video;
    });
    const input = wrapper.get('#projectFolderInput');
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file, ...videos] });
    await input.trigger('change');
    await settleFolder();
    expect(wrapper.findAll('#content video')).toHaveLength(2);
    expect(wrapper.get('#toast').text()).toContain('use Download to save');
    expect(wrapper.get('#status').text()).toBe('opened project.json (use Download to save)');
    expect(rememberHandle).toHaveBeenLastCalledWith(null);
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls.at(-1)[0])).toEqual(project);
  });
  it('asks which JSON to open instead of silently picking among multiple projects', async () => {
    const other = structuredClone(projectFixture);
    other.timing.title = 'Selected second project';
    const folder = nativeFolder({ 'a.json': projectFixture, 'b.json': other });
    const dialog = wrapper.get('.project-picker').element;
    dialog.showModal = vi.fn(() => { dialog.open = true; });
    dialog.close = vi.fn(() => { dialog.open = false; });
    await openNativeFolder(folder);
    expect(dialog.open).toBe(true);
    expect(wrapper.findAll('#content video')).toHaveLength(0);
    await wrapper.get('.project-picker select').setValue('1');
    await wrapper.get('.project-picker form').trigger('submit');
    await settleFolder();
    expect(wrapper.get('#titleIn').element.value).toBe('Selected second project');
    expect(wrapper.findAll('#content video')).toHaveLength(2);
    expect(dialog.open).toBe(false);
  });
  it('reports missing media explicitly while still opening and linking the remaining clips', async () => {
    const folder = nativeFolder();
    folder.sources.delete('two with spaces.mp4');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await openNativeFolder(folder);
    expect(wrapper.findAll('#content video')).toHaveLength(1);
    expect(wrapper.get('#toast').text()).toContain('media/two with spaces.mp4');
    expect(wrapper.findAll('#vlist .vrow')[1].text()).toContain('missing media');
    await wrapper.get('#scrub').setValue('1.8');
    expect(wrapper.get('#content').text()).toContain('Missing media');
  });
  it('restores a remembered folder and its videos, and relinks again after an external JSON update', async () => {
    const project = structuredClone(projectFixture), folder = nativeFolder({ 'project.json': project });
    wrapper.unmount();
    rememberedHandle.mockResolvedValue({ file: folder.manifests.get('project.json'), directory: folder.directory });
    wrapper = mount(App, { attachTo: document.body });
    await settleFolder();
    expect(wrapper.findAll('#content video')).toHaveLength(2);
    project.timing.title = 'Updated externally';
    window.dispatchEvent(new Event('focus'));
    await settleFolder();
    expect(wrapper.get('#titleIn').element.value).toBe('Updated externally');
    expect(wrapper.findAll('#content video')).toHaveLength(2);
  });
  it('reconnects both folder and project permissions before restoring video links', async () => {
    const folder = nativeFolder();
    folder.directory.queryPermission.mockResolvedValue('prompt');
    wrapper.unmount();
    rememberedHandle.mockResolvedValue({ file: folder.manifests.get('project.json'), directory: folder.directory });
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.get('#btnReconnect').text()).toContain('project.json');
    await wrapper.get('#btnReconnect').trigger('click');
    await settleFolder();
    expect(folder.directory.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(wrapper.findAll('#content video')).toHaveLength(2);
  });
  it('does not overwrite another project when an asynchronous folder load finishes late', async () => {
    const folder = nativeFolder();
    let complete;
    folder.manifests.get('project.json').getFile.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await openNativeFolder(folder);
    await wrapper.get('#btnNew').trigger('click');
    complete({ text: async () => JSON.stringify(projectFixture) });
    await settleFolder();
    expect(wrapper.get('#titleIn').element.value).toBe('New video');
    expect(wrapper.findAll('#content video')).toHaveLength(0);
    expect(wrapper.get('#toast').text()).toContain('Project changed while opening');
  });
  it('cancels folder selection without changing the current project', async () => {
    vi.stubGlobal('showDirectoryPicker', vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')));
    await wrapper.get('#btnOpenFolder').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('#stage .pill')).toHaveLength(6);
    expect(rememberHandle).not.toHaveBeenCalled();
    expect(wrapper.get('#btnOpenFolder').attributes('disabled')).toBeUndefined();
  });
  it('leaves the current project alone when the folder contains no JSON or choosing among projects is cancelled', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await openNativeFolder(nativeFolder({}));
    expect(wrapper.get('#toast').text()).toContain('No project JSON found');
    expect(wrapper.findAll('#stage .pill')).toHaveLength(6);
    const dialog = wrapper.get('.project-picker').element;
    dialog.showModal = vi.fn(() => { dialog.open = true; });
    dialog.close = vi.fn(() => { dialog.open = false; });
    await openNativeFolder(nativeFolder({ 'a.json': projectFixture, 'b.json': projectFixture }));
    await wrapper.get('.project-picker').trigger('cancel');
    await settleFolder();
    expect(wrapper.findAll('#stage .pill')).toHaveLength(6);
    expect(rememberHandle).not.toHaveBeenCalled();
  });
  it('rejects too-short sources, releases their URLs and leaves them visibly unlinked', async () => {
    const project = structuredClone(projectFixture);
    project.clips = [{ ...project.clips[0], start: 0, source_out: 50 }];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await openNativeFolder(nativeFolder({ 'project.json': project }));
    expect(wrapper.findAll('#content video')).toHaveLength(0);
    expect(wrapper.get('#vlist .vrow').text()).toContain('missing media');
    expect(wrapper.get('#toast').text()).toContain('shorter than the saved source out point');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it('reports out-of-folder references without accessing parent directories', async () => {
    const project = structuredClone(projectFixture);
    project.clips = [project.clips[0]];
    project.media[0].path = '../shared/video.mp4';
    const folder = nativeFolder({ 'project.json': project });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await openNativeFolder(folder);
    expect(wrapper.get('#toast').text()).toContain('outside the selected project folder');
    expect(folder.directory.getDirectoryHandle).not.toHaveBeenCalled();
    expect(wrapper.findAll('#content video')).toHaveLength(0);
  });
  it('releases staged videos if the project changes while media files are being opened', async () => {
    const folder = nativeFolder();
    let complete;
    folder.media.getFileHandle.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await openNativeFolder(folder);
    await wrapper.get('#btnNew').trigger('click');
    complete({ getFile: async () => new File(['video'], 'one.mp4') });
    await settleFolder();
    expect(wrapper.get('#titleIn').element.value).toBe('New video');
    expect(wrapper.findAll('#content video')).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it('keeps folder access when saving a copy beside the project and forgets it when saving elsewhere', async () => {
    const folder = nativeFolder();
    await openNativeFolder(folder);
    const writable = { write: vi.fn().mockResolvedValue(), close: vi.fn().mockResolvedValue() };
    const beside = { name: 'copy.json', createWritable: vi.fn().mockResolvedValue(writable) };
    folder.manifests.set('copy.json', beside);
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue(beside));
    await wrapper.get('#btnSaveAs').trigger('click');
    await flushPromises();
    expect(rememberHandle).toHaveBeenLastCalledWith({ file: beside, directory: folder.directory });
    const elsewhere = { name: 'elsewhere.json', createWritable: vi.fn().mockResolvedValue(writable) };
    window.showSaveFilePicker.mockResolvedValue(elsewhere);
    await wrapper.get('#btnSaveAs').trigger('click');
    await flushPromises();
    expect(rememberHandle).toHaveBeenLastCalledWith(elsewhere);
  });
  async function startPresentation() {
    let fullscreenElement = null, frame, now = 0;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
    wrapper.get('.preview-canvas').element.requestFullscreen = vi.fn(async function () {
      fullscreenElement = this;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { frame = callback; return 1; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    wrapper.findAll('#content video').forEach(video => {
      Object.defineProperty(video.element, 'readyState', { configurable: true, value: 4 });
    });
    await wrapper.get('#btnPresent').trigger('click');
    await flushPromises();
    return {
      async advance(time) { now = time; frame(time); await flushPromises(); },
      async exit() { fullscreenElement = null; document.dispatchEvent(new Event('fullscreenchange')); await flushPromises(); },
    };
  }
  it('loops the whole composition, rewinds video and chapters, and leaves normal editor playback non-looping', async () => {
    await addFiles('a.mp4', 'b.mp4');
    expect(wrapper.get('header #btnPresent').classes()).toContain('present');
    expect(wrapper.find('.preview-heading #btnPresent').exists()).toBe(false);
    const clock = await startPresentation(), preview = wrapper.findComponent(Preview);
    expect(preview.props()).toMatchObject({ playing: true, presentation: true, muted: true, cur: 0 });
    await clock.advance(79500);
    expect(preview.props('cur')).toBeCloseTo(79.5);
    expect(wrapper.get('#stage .pill.on').text()).toBe('SUSE Virtualization');
    await wrapper.get('[aria-label="Pause or resume fullscreen playback"]').trigger('click');
    await wrapper.get('[aria-label="Pause or resume fullscreen playback"]').trigger('click');
    expect(preview.props('cur')).toBeCloseTo(79.5);
    await clock.advance(80500);
    expect(preview.props('playing')).toBe(true);
    expect(preview.props('cur')).toBeCloseTo(0.5);
    expect(wrapper.get('#stage .pill.on').text()).toBe('SUSE Rancher Prime');
    expect(wrapper.findAll('#content video')[0].element.currentTime).toBeCloseTo(0.5);
    await clock.exit();
    expect(preview.props()).toMatchObject({ playing: false, presentation: false });
    await wrapper.get('#btnPlay').trigger('click');
    await clock.advance(180500);
    expect(preview.props()).toMatchObject({ playing: false, cur: 80 });
  });
  it('pauses the presentation clock while buffering and shows black gaps without editor labels', async () => {
    await addFiles('a.mp4', 'b.mp4');
    await wrapper.get('#vlist [aria-label="Source out"]').setValue('10');
    const clock = await startPresentation(), preview = wrapper.findComponent(Preview);
    await wrapper.findAll('#content video')[0].trigger('waiting');
    await clock.advance(5000);
    expect(preview.props('cur')).toBe(0);
    await wrapper.findAll('#content video')[0].trigger('canplay');
    await clock.advance(5100);
    expect(preview.props('cur')).toBeCloseTo(0.1);
    await clock.advance(25100);
    expect(preview.props('cur')).toBeCloseTo(20.1);
    expect(wrapper.get('#content').text()).toBe('');
    await clock.exit();
    expect(wrapper.get('#content').text()).toBe('no video at this time');
  });
  it('rewinds the same video across loop boundaries shorter than the drift tolerance', async () => {
    await addFiles('short.mp4');
    await wrapper.get('#vlist [aria-label="Source out"]').setValue('0.2');
    const clock = await startPresentation(), video = wrapper.get('#content video').element;
    await clock.advance(150);
    video.currentTime = 0.15;
    await clock.advance(250);
    expect(wrapper.findComponent(Preview).props('cur')).toBeCloseTo(0.05);
    expect(video.currentTime).toBeCloseTo(0.05);
  });
  it('holds the final decoded frame until the project loops instead of restarting an ended video early', async () => {
    await addFiles('a.mp4');
    const clock = await startPresentation(), video = wrapper.get('#content video').element;
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockClear();
    video.currentTime = 40;
    Object.defineProperty(video, 'ended', { configurable: true, get: () => video.currentTime >= 40 });
    await clock.advance(39950);
    expect(play).not.toHaveBeenCalled();
    await clock.advance(40050);
    expect(video.currentTime).toBeCloseTo(0.05);
    expect(play).toHaveBeenCalledOnce();
  });
  it('stops and visibly reports media playback failures instead of silently running the loop', async () => {
    await addFiles('a.mp4');
    const clock = await startPresentation();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('Autoplay denied'));
    await wrapper.get('#content video').trigger('canplay');
    await flushPromises();
    expect(wrapper.findComponent(Preview).props('playing')).toBe(false);
    expect(wrapper.get('[role=alert]').text()).toContain('Could not play a.mp4: Autoplay denied');
    expect(logged).toHaveBeenCalled();
    await clock.exit();
  });
  it('keeps presentation controls out of project data and disables editing shortcuts in fullscreen', async () => {
    await addFiles('a.mp4');
    await wrapper.get('#btnDownload').trigger('click');
    const before = JSON.parse(downloadJSON.mock.calls.at(-1)[0]);
    const clock = await startPresentation(), preview = wrapper.findComponent(Preview);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('#content video')).toHaveLength(1);
    expect(preview.props('cur')).toBe(0);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(preview.props('playing')).toBe(false);
    await wrapper.get('.presentation-controls [aria-pressed]').trigger('click');
    expect(wrapper.get('#content video').element.muted).toBe(false);
    await clock.exit();
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls.at(-1)[0])).toEqual(before);
  });
  it('opens shortcut help during fullscreen and keeps playback hotkeys inactive until help closes', async () => {
    await addFiles('a.mp4');
    const clock = await startPresentation(), dialog = wrapper.get('dialog').element;
    dialog.showModal = vi.fn(() => { dialog.open = true; });
    dialog.close = vi.fn(() => { dialog.open = false; dialog.dispatchEvent(new Event('close')); });
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(dialog.open).toBe(true);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(Preview).props('playing')).toBe(true);
    await wrapper.get('dialog').trigger('cancel');
    expect(dialog.open).toBe(false);
    await clock.exit();
  });
  it('shows decoding errors and stops fullscreen playback', async () => {
    await addFiles('broken.mp4');
    const clock = await startPresentation();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await wrapper.get('#content video').trigger('error');
    expect(wrapper.findComponent(Preview).props('playing')).toBe(false);
    expect(wrapper.get('[role=alert]').text()).toContain('Could not load broken.mp4');
    await clock.exit();
  });
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
  it('follows a re-exported file when it is relinked: longer pushes later clips, shorter shortens, trims are kept', async () => {
    async function relink(row, length) {
      videoLength = length;
      await wrapper.findAll('#vlist .vrow')[row].get('.relink-media').trigger('click');
      const input = wrapper.get('#relinkFile');
      Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'a.mp4')], configurable: true });
      await input.trigger('change');
      await new Promise(resolve => setTimeout(resolve, 20));
      await flushPromises();
    }
    const clips = async () => { await wrapper.get('#btnDownload').trigger('click');
      return JSON.parse(downloadJSON.mock.calls.at(-1)[0]).clips; };
    await addFiles('a.mp4', 'b.mp4');                       // 0-40 and 40-80
    await wrapper.get('#settings-tab').trigger('click');
    await relink(0, 25);                                    // edited down to 25 s
    expect(wrapper.get('#toast').text()).toContain('clip length updated');
    expect((await clips()).map(c => [c.start, c.source_out])).toEqual([[0, 25], [40, 40]]);
    await relink(0, 50);                                    // and later extended to 50 s: b moves along
    expect((await clips()).map(c => [c.start, c.source_out])).toEqual([[0, 50], [65, 40]]);
    await wrapper.findAll('#vlist .vrow')[0].get('[aria-label="Source in"]').setValue('5');
    await wrapper.findAll('#vlist .vrow')[0].get('[aria-label="Source out"]').setValue('20');
    await relink(0, 30);                                    // a trim that still fits is left alone
    expect((await clips())[0]).toMatchObject({ source_in: 5, source_out: 20 });
    await relink(0, 4);                                     // shorter than the In point: refused
    expect(wrapper.get('#toast').text()).toContain('shorter than where the clip starts');
    expect((await clips())[0]).toMatchObject({ source_in: 5, source_out: 20 });
  });
  it('the Export button opens the export dialog with the linked videos and the project resolution', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, encoders: {} }) })));
    await wrapper.get('#btnExport').trigger('click');
    await flushPromises();
    expect(wrapper.get('#exportNoVideo').text()).toContain('Add a video first');
    await wrapper.get('.export-dialog .ghost').trigger('click');
    await addFiles('a.mp4', 'b.mp4');
    await wrapper.get('#settings-tab').trigger('click');
    await wrapper.get('#outputResolution').setValue('1280x720');
    await wrapper.get('#btnExport').trigger('click');
    await flushPromises();
    expect(wrapper.find('#exportNoVideo').exists()).toBe(false);
    expect(wrapper.find('#exportMissing').exists()).toBe(false);
    expect(wrapper.get('#exportResolution').element.value).toBe('1280x720');
    expect(wrapper.get('.export-chips').text()).toContain('2 videos');
    expect(wrapper.get('#exportStart').attributes('disabled')).toBeUndefined();
    expect(wrapper.findComponent({ name: 'ExportDialog' }).props('startIn')).toBeNull();   // nothing linked to a folder yet
    await wrapper.get('.export-x').trigger('click');
    expect(wrapper.find('.export-dialog').exists()).toBe(false);
  });
  it('the export dialog asks to relink videos that were opened without their files', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, encoders: {} }) })));
    await importProject(structuredClone(projectFixture));
    await wrapper.get('#btnExport').trigger('click');
    await flushPromises();
    expect(wrapper.get('#exportMissing').text()).toContain('not linked');
    expect(wrapper.get('#exportStart').attributes('disabled')).toBeDefined();
  });
  it('applies the media folder to all videos and updates every reference when it changes, with undo', async () => {
    await wrapper.get('#settings-tab').trigger('click');
    expect(wrapper.get('#mediaFolder').element.value).toBe('');
    await addFiles('original.mp4');
    await wrapper.get('#mediaFolder').setValue(' ./shared videos//takes/ ');
    expect(wrapper.get('#mediaFolder').element.value).toBe('shared videos/takes');
    expect(wrapper.get('#vlist [aria-label="Media path"]').element.value).toBe('original.mp4');
    expect(wrapper.get('#vlist .resolved-media-path').text()).toBe('Project path: shared videos/takes/original.mp4');
    await addFiles('new clip.mp4', 'another.mp4');
    await wrapper.get('#btnDownload').trigger('click');
    const project = JSON.parse(downloadJSON.mock.calls.at(-1)[0]);
    expect(project.media_folder).toBe('shared videos/takes');
    expect(project.media.map(media => media.path)).toEqual(['original.mp4', 'new clip.mp4', 'another.mp4']);
    expect(wrapper.findAll('#vlist .resolved-media-path').map(path => path.text())).toEqual([
      'Project path: shared videos/takes/original.mp4',
      'Project path: shared videos/takes/new clip.mp4',
      'Project path: shared videos/takes/another.mp4',
    ]);
    await wrapper.get('#mediaFolder').setValue('recordings');
    expect(wrapper.findAll('#vlist .resolved-media-path').map(path => path.text())).toEqual([
      'Project path: recordings/original.mp4', 'Project path: recordings/new clip.mp4', 'Project path: recordings/another.mp4',
    ]);
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls.at(-1)[0])).toEqual({ ...project, media_folder: 'recordings' });
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.get('#mediaFolder').element.value).toBe('shared videos/takes');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.findAll('#vlist .vrow')).toHaveLength(1);
    expect(wrapper.get('#mediaFolder').element.value).toBe('shared videos/takes');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.get('#mediaFolder').element.value).toBe('');
    expect(wrapper.get('#vlist [aria-label="Media path"]').element.value).toBe('original.mp4');
    expect(wrapper.get('#vlist .resolved-media-path').text()).toBe('Project path: original.mp4');
  });
  it('loads a media-folder base with its document, supports clearing it and resets it for New', async () => {
    await importProject(folderProject());
    expect(wrapper.get('#mediaFolder').element.value).toBe('media');
    await addFiles('new.mp4');
    expect(wrapper.findAll('#vlist [aria-label="Media path"]').at(-1).element.value).toBe('new.mp4');
    expect(wrapper.findAll('#vlist .resolved-media-path').at(-1).text()).toBe('Project path: media/new.mp4');
    await wrapper.get('#mediaFolder').setValue('');
    expect(wrapper.findAll('#vlist .resolved-media-path').at(-1).text()).toBe('Project path: new.mp4');
    await addFiles('beside-json.mp4');
    expect(wrapper.findAll('#vlist [aria-label="Media path"]').at(-1).element.value).toBe('beside-json.mp4');
    await wrapper.get('#mediaFolder').setValue('other');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await wrapper.get('#btnNew').trigger('click');
    expect(wrapper.get('#mediaFolder').element.value).toBe('');
    await addFiles('fresh.mp4');
    expect(wrapper.get('#vlist [aria-label="Media path"]').element.value).toBe('fresh.mp4');
  });
  it('rejects invalid media folders without replacing the previous setting', async () => {
    await wrapper.get('#mediaFolder').setValue('media');
    for (const folder of ['/absolute', 'C:/videos', 'https://example.com', 'media\\videos']) {
      await wrapper.get('#mediaFolder').setValue(folder);
      expect(wrapper.get('#toast').text()).toContain('Media folder must be a relative path');
      expect(wrapper.get('#mediaFolder').element.value).toBe('media');
    }
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls.at(-1)[0]).media_folder).toBe('media');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.get('#mediaFolder').element.value).toBe('');
  });
  it('uses the current media-folder base consistently even if it changes while videos load', async () => {
    const pending = Promise.withResolvers();
    const load = vi.spyOn(await import('./videos.js'), 'loadClip')
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ name: 'second.mp4', dur: 40, url: 'blob:second', start: 0 });
    await wrapper.get('#mediaFolder').setValue('media');
    const input = wrapper.get('#videoFile');
    Object.defineProperty(input.element, 'files', {
      value: [new File(['x'], 'first.mp4'), new File(['x'], 'second.mp4')], configurable: true,
    });
    await input.trigger('change');
    expect(load).toHaveBeenCalledTimes(1);
    await wrapper.get('#mediaFolder').setValue('next-batch');
    pending.resolve({ name: 'first.mp4', dur: 40, url: 'blob:first', start: 0 });
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);
    await wrapper.get('#btnDownload').trigger('click');
    const project = JSON.parse(downloadJSON.mock.calls.at(-1)[0]);
    expect(project.media_folder).toBe('next-batch');
    expect(project.media.map(media => media.path)).toEqual(['first.mp4', 'second.mp4']);
    expect(wrapper.findAll('#vlist .resolved-media-path').map(path => path.text())).toEqual([
      'Project path: next-batch/first.mp4', 'Project path: next-batch/second.mp4',
    ]);
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
