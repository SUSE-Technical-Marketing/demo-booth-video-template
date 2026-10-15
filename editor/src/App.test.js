import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';
import Preview from './components/Preview.vue';
import TimeInput from './components/TimeInput.vue';
import { DEFAULT, fromJSON } from './timing.js';
import { createProject, toProjectJSON } from './project.js';
import { downloadJSON, rememberHandle, rememberedHandle } from './fileAccess.js';

vi.mock('./fileAccess.js', () => ({
  downloadJSON: vi.fn(),
  rememberHandle: vi.fn().mockResolvedValue(),
  rememberedHandle: vi.fn().mockResolvedValue(null),
  pickerOptions: {},
}));

let wrapper;
const toJSON = state => toProjectJSON({ output: { fps: '25/1' }, media: [], clips: [], ...state });
const projectDocument = timing => JSON.parse(toJSON(fromJSON(timing)));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: text => ({ width: text.length * 14 }),
  });
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('showOpenFilePicker', undefined);
  vi.stubGlobal('showSaveFilePicker', undefined);
  localStorage.clear();
  rememberedHandle.mockResolvedValue(null);
  wrapper = mount(App, { attachTo: document.body });
});
afterEach(() => {
  wrapper.unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function editTitle(ch, text) {
  const input = wrapper.get(`#chapters input[data-chapter="${ch}"]`);
  await input.trigger('focus');
  await input.setValue(text);
}
async function chooseChapter(index) {
  await wrapper.findAll('.chapter-count')[index].trigger('click');
  return wrapper.get('.chapter-inspector');
}
async function openLinkedFile(data = JSON.parse(toJSON(fromJSON(DEFAULT)))) {
  if (!data.project_version && data.chapters?.length) data = projectDocument(data);
  const writable = { write: vi.fn().mockResolvedValue(), close: vi.fn().mockResolvedValue() };
  const fileHandle = {
    name: 'linked.json', getFile: vi.fn().mockResolvedValue({ text: async () => JSON.stringify(data) }),
    createWritable: vi.fn().mockResolvedValue(writable), queryPermission: vi.fn().mockResolvedValue('granted'),
  };
  vi.stubGlobal('showOpenFilePicker', vi.fn().mockResolvedValue([fileHandle]));
  await wrapper.get('#btnOpen').trigger('click');
  await flushPromises();
  return { fileHandle, writable };
}

describe('Vue editor', () => {
  it('switches video themes live, persists them and restores the previous layout with undo', async () => {
    await wrapper.get('#settings-tab').trigger('click');
    expect(wrapper.get('#videoTheme').element.value).toBe('dark-rail');
    expect(wrapper.get('#stage').attributes('data-theme')).toBe('dark-rail');
    const chapters = wrapper.findAll('#stage .pill').map(pill => pill.text());
    await wrapper.get('#scrub').setValue('32');
    await wrapper.get('#videoTheme').setValue('cinematic');
    expect(wrapper.get('#stage').attributes('data-theme')).toBe('cinematic');
    expect(wrapper.find('#chapterViewport').exists()).toBe(false);
    expect(wrapper.get('#currentChapter').text()).toContain('SUSE Observability');
    expect(wrapper.get('#scrub').element.value).toBe('32');
    expect(wrapper.get('#status').classes()).toContain('dirty');
    await wrapper.get('#btnDownload').trigger('click');
    const saved = JSON.parse(downloadJSON.mock.calls.at(-1)[0]);
    expect(saved.output).toEqual({ fps: '25/1', theme: 'cinematic' });
    await wrapper.get('#outputFPS').setValue('30000/1001');
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls.at(-1)[0]).output.theme).toBe('cinematic');
    await wrapper.get('#btnUndo').trigger('click');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.get('#stage').attributes('data-theme')).toBe('dark-rail');
    expect(wrapper.findAll('#stage .pill').map(pill => pill.text())).toEqual(chapters);
    await wrapper.get('#videoTheme').setValue('classic');
    expect(wrapper.get('#content').element.style.width).toBe('1459px');
    expect(wrapper.find('#chapterProgress').exists()).toBe(false);
    await wrapper.get('#videoTheme').setValue('minimal-stage');
    expect(wrapper.get('#stage').attributes('data-theme')).toBe('minimal-stage');
    expect(wrapper.get('#content').element.style.width).toBe('1536px');
    expect(wrapper.find('#panel').exists()).toBe(false);
    expect(wrapper.get('#chapterViewport').element.style.top).toBe('1008px');
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls.at(-1)[0]).output.theme).toBe('minimal-stage');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.get('#stage').attributes('data-theme')).toBe('classic');
  });
  it('saves the output resolution and restores the previous size with undo', async () => {
    await wrapper.get('#settings-tab').trigger('click');
    expect(wrapper.get('#outputResolution').element.value).toBe('1920x1080');
    await wrapper.get('#outputResolution').setValue('1920x1080');
    expect(wrapper.get('#status').classes()).not.toContain('dirty');
    await wrapper.get('#outputResolution').setValue('1280x720');
    expect(wrapper.get('#outputResolution').element.value).toBe('1280x720');
    expect(wrapper.get('#status').classes()).toContain('dirty');
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls.at(-1)[0]).output).toEqual({ fps: '25/1', theme: 'dark-rail', resolution: '1280x720' });
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.get('#outputResolution').element.value).toBe('1920x1080');
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls.at(-1)[0]).output).toEqual({ fps: '25/1', theme: 'dark-rail' });
  });
  it('opens older projects as Classic and autosaves a theme change', async () => {
    const { writable } = await openLinkedFile();
    expect(wrapper.get('#videoTheme').element.value).toBe('classic');
    vi.useFakeTimers();
    await wrapper.get('#settings-tab').trigger('click');
    await wrapper.get('#videoTheme').setValue('dark-rail');
    await vi.advanceTimersByTimeAsync(700);
    await flushPromises();
    expect(JSON.parse(writable.write.mock.calls.at(-1)[0]).output.theme).toBe('dark-rail');
  });
  it('autosaves media-folder edits and undo, including an empty folder', async () => {
    const project = projectDocument(DEFAULT);
    project.media_folder = 'media';
    const { writable } = await openLinkedFile(project);
    expect(wrapper.get('#mediaFolder').element.value).toBe('media');
    vi.useFakeTimers();
    await wrapper.get('#mediaFolder').setValue('recordings');
    await vi.advanceTimersByTimeAsync(700);
    await flushPromises();
    expect(JSON.parse(writable.write.mock.calls.at(-1)[0]).media_folder).toBe('recordings');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.get('#mediaFolder').element.value).toBe('media');
    await vi.advanceTimersByTimeAsync(700);
    await flushPromises();
    expect(JSON.parse(writable.write.mock.calls.at(-1)[0]).media_folder).toBe('media');
    await wrapper.get('#mediaFolder').setValue('');
    await vi.advanceTimersByTimeAsync(700);
    await flushPromises();
    expect(JSON.parse(writable.write.mock.calls.at(-1)[0]).media_folder).toBe('');
  });
  it('shows one sidebar tab at a time while preserving edits, selection and panel instances', async () => {
    const chapters = wrapper.get('#chapters-panel'), settings = wrapper.get('#settings-panel');
    const inspector = wrapper.get('.chapter-inspector').element;
    expect(chapters.isVisible()).toBe(true);
    expect(settings.isVisible()).toBe(false);
    expect(wrapper.find('.project-settings summary').exists()).toBe(false);
    expect(wrapper.get('#chapters-tab').attributes('aria-selected')).toBe('true');
    await wrapper.get('#settings-tab').trigger('click');
    expect(wrapper.get('#status').classes()).not.toContain('dirty');
    expect(settings.isVisible()).toBe(true);
    expect(chapters.isVisible()).toBe(false);
    expect(wrapper.get('#settings-tab').attributes('aria-selected')).toBe('true');
    await wrapper.get('#titleIn').trigger('focus');
    await wrapper.get('#titleIn').setValue('Updated project');
    await wrapper.get('#rippleBy').setValue('7');
    await wrapper.get('#chapters-tab').trigger('click');
    await chooseChapter(2);
    const selected = wrapper.get('.chapter-inspector').attributes('data-chapter-id');
    await wrapper.get('#settings-tab').trigger('click');
    expect(wrapper.get('#titleIn').element.value).toBe('Updated project');
    expect(wrapper.get('#rippleBy').element.value).toBe('7');
    await wrapper.get('#chapters-tab').trigger('click');
    expect(wrapper.get('.chapter-inspector').element).toBe(inspector);
    expect(wrapper.get('.chapter-inspector').attributes('data-chapter-id')).toBe(selected);
    expect(wrapper.get('#scrub').element.value).toBe('60.1');
  });
  it('supports accessible keyboard tab switching without starting playback', async () => {
    const chapters = wrapper.get('#chapters-tab'), settings = wrapper.get('#settings-tab');
    chapters.element.focus();
    await chapters.trigger('keydown', { key: 'ArrowRight' });
    expect(document.activeElement).toBe(settings.element);
    expect(settings.attributes('tabindex')).toBe('0');
    expect(chapters.attributes('tabindex')).toBe('-1');
    expect(wrapper.get('#settings-panel').attributes('aria-labelledby')).toBe(settings.attributes('id'));
    await settings.trigger('keydown', { key: 'ArrowRight' });
    expect(document.activeElement).toBe(chapters.element);
    await chapters.trigger('keydown', { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(settings.element);
    await settings.trigger('keydown', { key: 'Home' });
    expect(document.activeElement).toBe(chapters.element);
    await chapters.trigger('keydown', { key: 'End' });
    expect(document.activeElement).toBe(settings.element);
    await settings.trigger('keydown', { key: ' ', code: 'Space' });
    expect(wrapper.findComponent(Preview).props('playing')).toBe(false);
  });
  it('returns to chapter editing on timeline selection, but not when following playback', async () => {
    await wrapper.get('#followPlayhead').setValue(true);
    await wrapper.get('#settings-tab').trigger('click');
    await wrapper.get('#scrub').setValue('60');
    expect(wrapper.get('#settings-panel').isVisible()).toBe(true);
    await wrapper.findAll('#tl .band')[1].trigger('click');
    expect(wrapper.get('#chapters-panel').isVisible()).toBe(true);
    expect(wrapper.get('.chapter-inspector h3').text()).toBe(DEFAULT.chapters[1]);
    await wrapper.get('#settings-tab').trigger('click');
    await wrapper.findAll('#tl .headline-band')[4].trigger('click');
    await nextTick();
    expect(wrapper.get('#chapters-panel').isVisible()).toBe(true);
    expect(wrapper.get('.chapter-inspector h3').text()).toBe(DEFAULT.chapters[2]);
    expect(wrapper.get('.headline-list .row.sel').isVisible()).toBe(true);
  });
  it('keeps timeline and playback separate from the scrolling editing workspace', () => {
    expect(wrapper.find('.editor-panel #chapters').exists()).toBe(true);
    expect(wrapper.find('.editor-panel .chapter-inspector .headline-list').exists()).toBe(true);
    expect(wrapper.find('.preview-canvas #view').exists()).toBe(true);
    expect(wrapper.find('.workspace #tl').exists()).toBe(false);
    expect(wrapper.find('.timeline-dock #tl').exists()).toBe(true);
    expect(wrapper.find('.timeline-dock #btnPlay').exists()).toBe(true);
    expect(wrapper.find('.timeline-dock #scrub').exists()).toBe(true);
  });
  it('renders sample chapters, headlines, accents and timeline', () => {
    expect(wrapper.findAll('#stage .pill')).toHaveLength(6);
    expect(wrapper.findAll('.headline-list .row')).toHaveLength(2);
    expect(wrapper.findAll('#tl .headline-band')).toHaveLength(12);
    expect(wrapper.findAll('#tl .band')).toHaveLength(6);
    expect(wrapper.get('#hl b').text()).toBe('Kubernetes,');
  });
  it('adds custom chapters beyond six and synchronizes all titles', async () => {
    for (let i = 0; i < 6; i++) await wrapper.get('#addChapter').trigger('click');
    await editTitle(12, 'A custom chapter');
    expect(wrapper.findAll('#stage .pill')).toHaveLength(12);
    expect(wrapper.findAll('#stage .pill').at(-1).text()).toBe('A custom chapter');
    expect(wrapper.get('#chapters input[data-chapter="12"]').element.value).toBe('A custom chapter');
    expect(wrapper.findAll('#chapters .crow')).toHaveLength(12);
    expect(wrapper.find('#chapters select').exists()).toBe(false);
    expect(wrapper.get('#chapterCounter').text()).toContain('of 12');
  });
  it('deletes middle chapters, renumbers, and restores them with undo', async () => {
    await wrapper.findAll('#chapters .crow')[2].get('button[title="Delete chapter"]').trigger('click');
    expect(wrapper.findAll('#stage .pill')).toHaveLength(5);
    expect(wrapper.findAll('#stage .pill')[2].text()).toBe('SUSE Security');
    expect(wrapper.findAll('#chapters .chapter-number')[2].text()).toBe('3');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.findAll('#stage .pill')).toHaveLength(6);
    expect(wrapper.findAll('#stage .pill')[2].text()).toBe('SUSE Virtualization');
  });
  it('matches preview, editor and saved chapter order after moving a chapter', async () => {
    const time = wrapper.findAll('#chapters .crow .time')[2];
    await time.trigger('focus');
    await time.setValue('0:10');
    const orderedTitles = [DEFAULT.chapters[0], DEFAULT.chapters[2], DEFAULT.chapters[1], ...DEFAULT.chapters.slice(3)];
    expect(wrapper.findAll('#stage .pill').map(pill => pill.text())).toEqual(orderedTitles);
    expect(wrapper.findAll('#chapters .chapter-title').map(input => input.element.value)).toEqual(orderedTitles);
    expect(wrapper.get('.pill.on').text()).toBe(DEFAULT.chapters[2]);
    await wrapper.get('#btnDownload').trigger('click');
    const saved = JSON.parse(downloadJSON.mock.calls[0][0]).timing;
    expect(saved.chapters.map(c => c.title)).toEqual(orderedTitles);
    expect(saved.chapters.slice(0, 3).map(c => c.start)).toEqual([0, 10, 30]);
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.findAll('#stage .pill').map(pill => pill.text())).toEqual(DEFAULT.chapters);
  });
  it('inserts a new chapter at the playhead and focuses its remapped title', async () => {
    await wrapper.get('#scrub').setValue('15');
    await wrapper.get('#addChapter').trigger('click');
    expect(wrapper.findAll('#stage .pill')[1].text()).toBe('New chapter');
    const input = wrapper.get('#chapters input[data-chapter="2"]');
    expect(wrapper.find('#names').exists()).toBe(false);
    expect(document.activeElement).toBe(input.element);
    await input.setValue('Inserted chapter');
    expect(wrapper.findAll('#stage .pill')[1].text()).toBe('Inserted chapter');
    expect(wrapper.get('#chapters input[data-chapter="2"]').element.value).toBe('Inserted chapter');
  });
  it('keeps independent chapters with repeated titles independent', async () => {
    const { writable } = await openLinkedFile({
      ...DEFAULT, chapters: ['Intro', 'Details', 'Wrap up'],
      chapter_starts: [[0, 1], [10, 2], [20, 3], [30, 2]],
    });
    expect(wrapper.findAll('#stage .pill').map(pill => pill.text())).toEqual(['Intro', 'Details', 'Wrap up', 'Details']);
    expect(wrapper.get('#status').text()).toBe('saved to linked.json');
    expect(writable.write).not.toHaveBeenCalled();
    await editTitle(2, 'Renamed details');
    expect(wrapper.findAll('#stage .pill').at(-1).text()).toBe('Details');
    await wrapper.findAll('#chapters .crow')[1].get('button[title="Delete chapter"]').trigger('click');
    expect(wrapper.findAll('#stage .pill').map(pill => pill.text())).toEqual(['Intro', 'Wrap up', 'Details']);
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls[0][0]).timing.chapters.map(c => c.start)).toEqual([0, 20, 30]);
    await wrapper.get('#btnSave').trigger('click');
    await flushPromises();
    expect(JSON.parse(writable.write.mock.calls[0][0]).timing.chapters.map(c => c.start)).toEqual([0, 20, 30]);
    expect(wrapper.get('#status').text()).toBe('saved to linked.json');
  });
  it('offers only direct chapter editing, with no switch or reuse controls', () => {
    expect(wrapper.find('#addChapterSwitch').exists()).toBe(false);
    expect(wrapper.find('#chapters select').exists()).toBe(false);
    expect(wrapper.find('#names').exists()).toBe(false);
    expect(wrapper.findAll('#chapters .chapter-title')).toHaveLength(6);
    expect(wrapper.get('#stats').text()).not.toContain('switch');
  });
  it('updates metadata and inline chapter titles through component events with undo', async () => {
    const product = wrapper.get('#productIn');
    await product.trigger('focus');
    await product.setValue('Updated product');
    expect(wrapper.get('#prodname').text()).toBe('Updated product');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.get('#prodname').text()).toBe(DEFAULT.product_name);
    const title = wrapper.get('#chapters input[data-chapter="2"]');
    await title.trigger('focus');
    await title.setValue('Shared updated title');
    expect(wrapper.findAll('#chapters .chapter-title')[1].element.value).toBe('Shared updated title');
    expect(wrapper.findAll('#stage .pill')[1].text()).toBe('Shared updated title');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.findAll('#stage .pill')[1].text()).toBe(DEFAULT.chapters[1]);
  });
  it('forwards row time edits and playhead actions with undo', async () => {
    const time = wrapper.findAll('#chapters .crow .time')[1];
    await time.trigger('focus');
    await time.setValue('0:35');
    expect(wrapper.findAll('#chapters .crow .time')[1].element.value).toBe('0:35');
    expect(wrapper.get('#status').text()).toContain('unsaved');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.findAll('#chapters .crow .time')[1].element.value).toBe('0:30');
    await chooseChapter(0);
    await wrapper.get('#scrub').setValue('7');
    await wrapper.get('.headline-list button[title="Set time to the playhead"]').trigger('click');
    expect(wrapper.get('.headline-list .time').element.value).toBe('0:07');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.get('.headline-list .time').element.value).toBe('0:00');
  });
  it('sets a chapter start to the playhead, moving its headlines with it, without moving the playhead; one undo step', async () => {
    await wrapper.get('#scrub').setValue('12');
    const row = () => wrapper.findAll('#chapters .crow')[1];
    expect(row().get('.time').element.value).toBe('0:30');
    await row().get('button[title^="Set start to the playhead"]').trigger('click');
    expect(row().get('.time').element.value).toBe('0:12');
    expect(wrapper.get('#scrub').element.value).toBe('12');                       // the playhead did not move
    expect(wrapper.get('#toast').text()).toBe('Chapter 2 now starts at 0:12');
    expect(wrapper.get('#status').text()).toContain('unsaved');
    expect(row().classes()).toContain('sel');                                      // the edited chapter is selected
    expect(wrapper.get('.headline-list .time').element.value).toBe('0:00');       // its headlines kept their offsets
    await wrapper.get('#btnUndo').trigger('click');
    expect(row().get('.time').element.value).toBe('0:30');
  });
  it('moving a chapter to the playhead past its neighbour reorders the chapters like typing the time does', async () => {
    await wrapper.get('#scrub').setValue('70');
    await wrapper.findAll('#chapters .crow')[1].get('button[title^="Set start to the playhead"]').trigger('click');
    expect(wrapper.findAll('#chapters .crow .time').map(t => t.element.value).slice(0, 3)).toEqual(['0:00', '1:00', '1:10']);
    expect(wrapper.findAll('#chapters .crow .chapter-title')[2].element.value).toBe(DEFAULT.chapters[1]);   // it kept its title
  });
  it('keeps at least one chapter but allows removing every headline', async () => {
    while (wrapper.findAll('#chapters .crow').length > 1) {
      await wrapper.findAll('#chapters .crow').at(-1).get('button[title="Delete chapter"]').trigger('click');
    }
    await wrapper.get('#chapters .crow button[title="Delete chapter"]').trigger('click');
    expect(wrapper.findAll('#stage .pill')).toHaveLength(1);
    expect(wrapper.get('#toast').text()).toContain('Keep at least one');
    while (wrapper.findAll('.headline-list .row').length) {
      await wrapper.findAll('.headline-list .row').at(-1).get('button[title="Delete"]').trigger('click');
    }
    expect(wrapper.findAll('.headline-list .row')).toHaveLength(0);
    expect(wrapper.get('#hl').text()).toBe('');
  });
  it('edits headlines, adds with Enter, and applies ripple with undo', async () => {
    const text = wrapper.get('.headline-list input:not(.time)');
    await text.trigger('focus');
    await text.setValue('A *new accent* headline');
    expect(wrapper.get('#hl').text()).toBe('A new accent headline');
    expect(wrapper.findAll('#hl b')).toHaveLength(2);
    await text.trigger('keydown', { key: 'Enter' });
    expect(wrapper.findAll('.headline-list .row')).toHaveLength(3);
    await wrapper.get('#scrub').setValue('30');
    await wrapper.get('#rippleBy').setValue('-5');
    await wrapper.get('#btnRipple').trigger('click');
    expect(wrapper.findAll('#chapters .crow .time')[1].element.value).toBe('0:25');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.findAll('#chapters .crow .time')[1].element.value).toBe('0:30');
  });
  it('links, remembers, saves and autosaves files without a backend', async () => {
    const { writable } = await openLinkedFile();
    expect(rememberHandle).toHaveBeenCalled();
    await editTitle(1, 'Renamed');
    await wrapper.get('#btnSave').trigger('click');
    await flushPromises();
    expect(JSON.parse(writable.write.mock.calls[0][0]).timing.chapters[0].title).toBe('Renamed');
    expect(wrapper.get('#status').text()).toBe('saved to linked.json');
    vi.useFakeTimers();
    await editTitle(1, 'Autosaved');
    await vi.advanceTimersByTimeAsync(700);
    await flushPromises();
    expect(JSON.parse(writable.write.mock.calls.at(-1)[0]).timing.chapters[0].title).toBe('Autosaved');
  });
  it('preserves edits made during an asynchronous save', async () => {
    const { writable } = await openLinkedFile();
    let completeWrite;
    writable.write.mockImplementationOnce(() => new Promise(resolve => { completeWrite = resolve; }));
    await editTitle(1, 'First edit');
    await wrapper.get('#btnSave').trigger('click');
    await flushPromises();
    await editTitle(1, 'Second edit');
    completeWrite();
    await flushPromises();
    expect(wrapper.get('#status').text()).toContain('unsaved');
  });
  it('creates a linked file with the save picker', async () => {
    const writable = { write: vi.fn().mockResolvedValue(), close: vi.fn().mockResolvedValue() };
    const fileHandle = { name: 'new.json', createWritable: vi.fn().mockResolvedValue(writable) };
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue(fileHandle));
    await editTitle(1, 'New file title');
    await wrapper.get('#btnSave').trigger('click');
    await flushPromises();
    expect(JSON.parse(writable.write.mock.calls[0][0]).timing.chapters[0].title).toBe('New file title');
    expect(rememberHandle).toHaveBeenCalledWith(fileHandle);
    expect(wrapper.get('#status').text()).toBe('saved to new.json');
  });
  it('Save as links to the new file and leaves the old one alone; cancelling changes nothing', async () => {
    const { fileHandle, writable } = await openLinkedFile();
    const newWritable = { write: vi.fn().mockResolvedValue(), close: vi.fn().mockResolvedValue() };
    const copy = { name: 'copy.json', createWritable: vi.fn().mockResolvedValue(newWritable) };
    const picker = vi.fn().mockRejectedValueOnce(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
      .mockResolvedValueOnce(copy);
    vi.stubGlobal('showSaveFilePicker', picker);
    await wrapper.get('#btnSaveAs').trigger('click');
    await flushPromises();
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'linked.json' }));
    expect(wrapper.get('#status').text()).toBe('saved to linked.json');
    await wrapper.get('#btnSaveAs').trigger('click');
    await flushPromises();
    expect(newWritable.write).toHaveBeenCalledTimes(1);
    expect(rememberHandle).toHaveBeenLastCalledWith(copy);
    expect(wrapper.get('#status').text()).toBe('saved to copy.json');
    expect(writable.write).not.toHaveBeenCalled();                  // the original file was not touched
    await editTitle(1, 'After save as');
    await wrapper.get('#btnSave').trigger('click');                 // plain Save now goes to the copy
    await flushPromises();
    expect(newWritable.write).toHaveBeenCalledTimes(2);
    expect(fileHandle.createWritable).not.toHaveBeenCalled();
  });
  it('uses Download when the browser has no save picker', async () => {
    await wrapper.get('#btnSave').trigger('click');
    await flushPromises();
    expect(downloadJSON).toHaveBeenCalledOnce();
    expect(wrapper.get('#btnSave').attributes('disabled')).toBeUndefined();
  });
  it('restores a remembered handle after permission is granted', async () => {
    wrapper.unmount();
    const fileHandle = {
      name: 'remembered.json', queryPermission: vi.fn().mockResolvedValue('prompt'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
      getFile: vi.fn().mockResolvedValue({ text: async () => toJSON(fromJSON({ ...DEFAULT, title: 'Remembered title' })) }),
    };
    rememberedHandle.mockResolvedValue(fileHandle);
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.get('#btnReconnect').text()).toBe('Reconnect remembered.json');
    await wrapper.get('#btnReconnect').trigger('click');
    await flushPromises();
    expect(wrapper.get('#titleIn').element.value).toBe('Remembered title');
    expect(wrapper.find('#btnReconnect').exists()).toBe(false);
    expect(wrapper.get('#status').text()).toBe('saved to remembered.json');
  });
  it('does not replace new edits with an asynchronously remembered file', async () => {
    wrapper.unmount();
    let complete;
    rememberedHandle.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    wrapper = mount(App, { attachTo: document.body });
    await editTitle(1, 'New local edits');
    complete({
      name: 'remembered.json', queryPermission: vi.fn().mockResolvedValue('granted'),
      getFile: vi.fn().mockResolvedValue({ text: async () => JSON.stringify(DEFAULT) }),
    });
    await flushPromises();
    expect(wrapper.findAll('#stage .pill')[0].text()).toBe('New local edits');
  });
  it('rejects timing-only files when restoring a remembered file', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    wrapper.unmount();
    rememberedHandle.mockResolvedValue({
      name: 'legacy.json', queryPermission: vi.fn().mockResolvedValue('granted'),
      getFile: vi.fn().mockResolvedValue({ text: async () => JSON.stringify({
        ...DEFAULT, chapters: ['Intro', 'Details'], chapter_starts: [[0, 1], [10, 2], [20, 1]],
      }) }),
    });
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.findAll('#stage .pill')).toHaveLength(6);
    expect(wrapper.get('#toast').text()).toContain('Expected a version 1 project');
  });
  it('shows failed saves rather than claiming success', async () => {
    const { fileHandle } = await openLinkedFile();
    fileHandle.createWritable.mockRejectedValue(new Error('Disk is full'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await editTitle(1, 'Unsaved');
    await wrapper.get('#btnSave').trigger('click');
    await flushPromises();
    expect(wrapper.get('#toast').text()).toBe('Save failed: Disk is full');
    expect(wrapper.get('#status').text()).toContain('unsaved');
  });
  it('refreshes a linked file on focus without overwriting dirty edits', async () => {
    const { fileHandle } = await openLinkedFile();
    const changed = { ...DEFAULT, chapters: ['Changed externally', ...DEFAULT.chapters.slice(1)] };
    fileHandle.getFile.mockResolvedValue({ text: async () => JSON.stringify(projectDocument(changed)) });
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(wrapper.findAll('#stage .pill')[0].text()).toBe('Changed externally');
    await editTitle(1, 'Local unsaved edit');
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(wrapper.findAll('#stage .pill')[0].text()).toBe('Local unsaved edit');
  });
  it('rejects timing-only files on refresh without replacing the project', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const legacy = { ...DEFAULT, chapters: ['Intro', 'Details'], chapter_starts: [[0, 1], [10, 2], [20, 1]] };
    const { fileHandle, writable } = await openLinkedFile(JSON.parse(toJSON(fromJSON(legacy))));
    fileHandle.getFile.mockResolvedValue({ text: async () => JSON.stringify(legacy) });
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(wrapper.get('#toast').text()).toContain('Expected a version 1 project');
    expect(wrapper.get('#status').text()).toBe('saved to linked.json');
    expect(writable.write).not.toHaveBeenCalled();
  });
  it('downloads the renderer-compatible JSON schema', async () => {
    await editTitle(1, 'Download me');
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls[0][0]).timing).toMatchObject({
      schema_version: 2, chapters: [{ title: 'Download me', start: 0 }, ...DEFAULT.chapters.slice(1).map(title => ({ title }))],
    });
  });
  it('rejects malformed imported files without replacing state', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await openLinkedFile({ ...DEFAULT, chapters: [] });
    expect(wrapper.findAll('#stage .pill')).toHaveLength(6);
    expect(wrapper.get('#toast').text()).toContain('Open failed');
  });
  it('supports browser import fallback', async () => {
    const input = wrapper.get('input[type="file"]');
    const file = { text: async () => JSON.stringify(projectDocument({
      ...DEFAULT, title: 'Fallback file', chapters: ['Intro', 'Details'], chapter_starts: [[0, 1], [10, 2], [20, 1]],
    })), name: 'fallback.json' };
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
    await input.trigger('change');
    await flushPromises();
    expect(wrapper.get('#titleIn').element.value).toBe('Fallback file');
    expect(wrapper.get('#toast').text()).toContain('use Download');
    expect(wrapper.findAll('#chapters .chapter-title').map(title => title.element.value)).toEqual(['Intro', 'Details', 'Intro']);
  });

  const ownedDocument = {
    schema_version: 2,
    chapters: [
      { title: 'Intro', start: 0, headlines: [[0, 'First'], [8, 'Last'], [12, 'Outside']] },
      { title: 'Empty', start: 10, headlines: [] },
      { title: 'Later', start: 20, headlines: [[3, 'Delayed']] },
    ],
  };
  it('sets, exports, undoes and clears the last chapter end without loaded videos', async () => {
    await openLinkedFile(ownedDocument);
    await chooseChapter(2);
    await wrapper.get('#scrub').setValue('40');
    const end = wrapper.get('#chapterEndAt');
    await end.trigger('focus');
    await end.setValue('01:00:25');
    expect(end.element.value).toBe('0:25');
    expect(wrapper.get('#durChip').text()).toBe('to 0:25');
    expect(wrapper.get('.chapter-duration').text()).toBe('Length 0:05');
    expect(wrapper.get('#scrub').element.value).toBe('25');
    expect(wrapper.get('#hl').text()).toBe('');
    expect(wrapper.findAll('#tl .band').at(-1).attributes('title')).toBe('0:20 – 0:25');
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls[0][0]).timing.chapters_end).toBe(25);
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.get('#chapterEndAt').element.value).toBe('');
    expect(wrapper.get('#durChip').text()).toBe('to 1:30');
    await wrapper.get('#chapterEndAt').setValue('0:24');
    await wrapper.get('#chapterEndAt').setValue('');
    expect(wrapper.get('#durChip').text()).toBe('to 1:30');
  });
  it('rejects invalid or non-positive final chapter lengths without replacing the end', async () => {
    await openLinkedFile({ ...ownedDocument, chapters_end: 30 });
    await chooseChapter(2);
    for (const invalid of ['invalid', '20', '0', '-1']) {
      await wrapper.get('#chapterEndAt').setValue(invalid);
      expect(wrapper.get('#chapterEndAt').element.value).toBe('0:30');
      expect(wrapper.get('#toast').text()).toContain('end after the last chapter starts');
      expect(wrapper.get('#durChip').text()).toBe('to 0:30');
    }
  });
  it('ripples the configured end once and refuses to shift it before zero', async () => {
    await openLinkedFile({ ...ownedDocument, chapters_end: 30 });
    await wrapper.get('#scrub').setValue('5');
    await wrapper.get('#rippleBy').setValue('2');
    await wrapper.get('#btnRipple').trigger('click');
    expect(wrapper.get('#durChip').text()).toBe('to 0:32');
    await chooseChapter(2);
    expect(wrapper.get('.chapter-duration').text()).toBe('Length 0:10');
    await wrapper.get('#rippleBy').setValue('-40');
    await wrapper.get('#btnRipple').trigger('click');
    expect(wrapper.get('#toast').text()).toContain('last chapter end before 0.01 seconds');
    expect(wrapper.get('#durChip').text()).toBe('to 0:32');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.get('#durChip').text()).toBe('to 0:30');
  });
  it('shows only selected chapter headlines without duplicate DOM IDs', async () => {
    await openLinkedFile(ownedDocument);
    expect(wrapper.findAll('.crow')).toHaveLength(3);
    expect(wrapper.findAll('.headline-list .row')).toHaveLength(3);
    expect(wrapper.findAll('.chapter-count').map(button => button.text())).toEqual(['3!', '0', '1']);
    const inspector = await chooseChapter(2);
    expect(inspector.get('.headline-list .time').element.value).toBe('0:03');
    expect(inspector.get('.headline-list .time').attributes('title')).toBe('01:00:23');
    await chooseChapter(0);
    const ids = wrapper.findAll('[id]').map(element => element.attributes('id'));
    expect(new Set(ids).size).toBe(ids.length);
    await wrapper.get('#scrub').setValue('9');
    expect(wrapper.get('#hl').text()).toBe('Last');
    for (const time of ['10', '12', '20', '22']) {
      await wrapper.get('#scrub').setValue(time);
      expect(wrapper.get('#hl').text()).toBe('');
    }
    await wrapper.get('#scrub').setValue('24');
    expect(wrapper.get('#hl').text()).toBe('Delayed');
  });
  it('moves chapter-owned headlines and projects their new absolute timeline times', async () => {
    await openLinkedFile(ownedDocument);
    const row = wrapper.findAll('.crow')[2];
    await row.get('.time').trigger('focus');
    await row.get('.time').setValue('0:05');
    expect(wrapper.findAll('.chapter-title').map(input => input.element.value)).toEqual(['Intro', 'Later', 'Empty']);
    expect(wrapper.get('.chapter-inspector .headline-list .time').element.value).toBe('0:03');
    expect(wrapper.findAll('#tl .headline-band').some(band => band.attributes('title').startsWith('0:08 – 0:10  Delayed'))).toBe(true);
    await wrapper.get('#scrub').setValue('9');
    expect(wrapper.get('#hl').text()).toBe('Delayed');
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls[0][0]).timing.chapters[1]).toEqual({
      title: 'Later', start: 5, headlines: [[3, 'Delayed']],
    });
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.findAll('.chapter-title').map(input => input.element.value)).toEqual(['Intro', 'Empty', 'Later']);
  });
  it('retains shortened-chapter headlines with warnings instead of deleting or spilling them', async () => {
    await openLinkedFile(ownedDocument);
    const time = wrapper.findAll('.crow .time')[1];
    await time.trigger('focus');
    await time.setValue('0:05');
    await chooseChapter(0);
    const rows = wrapper.findAll('.headline-list .row');
    expect(rows).toHaveLength(3);
    expect(rows[1].get('.headline-error').text()).toContain('Outside chapter');
    expect(rows[1].get('input:not(.time)').element.value).toBe('Last');
    await wrapper.get('#scrub').setValue('8');
    expect(wrapper.get('#hl').text()).toBe('');
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls[0][0]).timing.chapters[0].headlines).toEqual(ownedDocument.chapters[0].headlines);
  });
  it('adds, edits and sets headline times relative to the chosen chapter', async () => {
    await openLinkedFile(ownedDocument);
    const group = await chooseChapter(1);
    await wrapper.get('#scrub').setValue('17');
    await group.get('.add-headline').trigger('click');
    const input = group.get('.headline-list input:not(.time)');
    expect(document.activeElement).toBe(input.element);
    expect(group.get('.headline-list .time').element.value).toBe('0:07');
    await input.setValue('Owned by empty');
    await group.get('.headline-list .time').setValue('01:00:14');
    expect(group.get('.headline-list .time').element.value).toBe('0:04');
    expect(wrapper.get('#hl').text()).toBe('Owned by empty');
    await wrapper.get('#scrub').setValue('12');
    await group.get('button[title="Set time to the playhead"]').trigger('click');
    expect(group.get('.headline-list .time').element.value).toBe('0:02');
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls[0][0]).timing.chapters[1].headlines).toEqual([[2, 'Owned by empty']]);
  });
  it('selects the owning chapter when jumping to its next headline', async () => {
    await openLinkedFile(ownedDocument);
    await wrapper.get('#scrub').setValue('15');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true }));
    await nextTick();
    expect(wrapper.get('.chapter-inspector h3').text()).toBe('Later');
    expect(wrapper.get('#hl').text()).toBe('Delayed');
    expect(wrapper.get('.headline-list .row.sel input:not(.time)').element.value).toBe('Delayed');
  });
  it('removes chapter children and restores ownership with undo', async () => {
    await openLinkedFile(ownedDocument);
    await wrapper.findAll('.crow')[0].get('button[title="Delete chapter"]').trigger('click');
    expect(wrapper.get('.chapter-inspector h3').text()).toBe('Empty');
    expect(wrapper.findAll('.headline-list .row')).toHaveLength(0);
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.findAll('.chapter-count').map(button => button.text())).toEqual(['3!', '0', '1']);
    await chooseChapter(0);
    expect(wrapper.findAll('.headline-list .row')).toHaveLength(3);
  });
  it('undoes adding a focused headline in one step', async () => {
    await openLinkedFile(ownedDocument);
    const group = await chooseChapter(1);
    await wrapper.get('#scrub').setValue('12');
    await group.get('.add-headline').trigger('click');
    expect(group.findAll('.headline-list .row')).toHaveLength(1);
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.findAll('.headline-list .row')).toHaveLength(0);
  });
  it('ripples absolute cue times without shifting chapter children twice', async () => {
    await openLinkedFile(ownedDocument);
    await wrapper.get('#scrub').setValue('5');
    await wrapper.get('#rippleBy').setValue('2');
    await wrapper.get('#btnRipple').trigger('click');
    await wrapper.get('#btnDownload').trigger('click');
    const saved = JSON.parse(downloadJSON.mock.calls[0][0]).timing;
    expect(saved.chapters[0].headlines).toEqual([[0, 'First'], [10, 'Last'], [14, 'Outside']]);
    expect(saved.chapters[1].start).toBe(12);
    expect(saved.chapters[2]).toEqual({ title: 'Later', start: 22, headlines: [[3, 'Delayed']] });
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.findAll('.crow .time').map(input => input.element.value)).toEqual(['0:00', '0:10', '0:20']);
  });
  it('keeps editing selection independent from scrubbing and follows only when requested', async () => {
    await openLinkedFile(ownedDocument);
    await chooseChapter(1);
    await wrapper.get('#scrub').setValue('24');
    expect(wrapper.get('.chapter-inspector h3').text()).toBe('Empty');
    expect(wrapper.get('.crow .dot.playing').element.closest('.crow').querySelector('.chapter-title').value).toBe('Later');
    await wrapper.get('#followPlayhead').setValue(true);
    expect(wrapper.get('.chapter-inspector h3').text()).toBe('Later');
    await wrapper.get('.headline-list input:not(.time)').trigger('focus');
    expect(wrapper.get('#followPlayhead').element.checked).toBe(false);
    await wrapper.get('#scrub').setValue('0');
    expect(wrapper.get('.chapter-inspector h3').text()).toBe('Later');
  });
  it('selects timeline chapter and headline bands without changing document data', async () => {
    await openLinkedFile(ownedDocument);
    const before = wrapper.get('#status').text();
    await wrapper.findAll('#tl .band')[1].trigger('click');
    expect(wrapper.get('.chapter-inspector h3').text()).toBe('Empty');
    const band = wrapper.findAll('#tl .headline-band').find(band => band.text() === 'Delayed');
    await band.trigger('click');
    await nextTick();
    expect(wrapper.get('.chapter-inspector h3').text()).toBe('Later');
    expect(wrapper.get('.headline-list .row.sel input:not(.time)').element.value).toBe('Delayed');
    expect(wrapper.get('#scrub').element.value).toBe('23');
    expect(wrapper.get('#status').text()).toBe(before);
  });
  it('preserves native Space activation on timeline buttons instead of starting playback', () => {
    const band = wrapper.findAll('#tl .headline-band')[0];
    band.element.focus();
    const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    band.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.get('#btnPlay').text()).toBe('Play');
  });
});

describe('keyboard shortcut help', () => {
  let dialog;
  beforeEach(() => {
    dialog = wrapper.get('dialog').element;
    dialog.showModal = vi.fn(() => {
      dialog.open = true;
      dialog.querySelector('button').focus();
    });
    dialog.close = vi.fn(() => {
      dialog.open = false;
      dialog.dispatchEvent(new Event('close'));
    });
  });
  async function pressQuestion(options = {}) {
    const event = new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true, ...options });
    document.activeElement.dispatchEvent(event);
    await nextTick();
    return event;
  }
  it('opens a named shortcut dialog with ? and closes it with ? again', async () => {
    expect(dialog.open).toBe(false);
    const event = await pressQuestion();
    expect(event.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe('shortcut-help-title');
    expect(wrapper.get('#shortcut-help-title').text()).toBe('Keyboard shortcuts');
    for (const shortcut of ['Ctrl / Cmd + S', 'Ctrl / Cmd + Shift + S', 'Ctrl / Cmd + Z',
      'Alt + Up / Down', 'Shift + Left / Right', 'Ctrl / Cmd + scroll', 'Home / End']) {
      expect(wrapper.get('.shortcut-help').text()).toContain(shortcut);
    }
    await pressQuestion();
    expect(dialog.open).toBe(false);
  });
  it('opens from the header and dismisses with Close, Escape or a backdrop click', async () => {
    await wrapper.get('header #btnShortcuts').trigger('click');
    expect(dialog.open).toBe(true);
    await wrapper.get('[aria-label="Close keyboard shortcuts"]').trigger('click');
    expect(dialog.open).toBe(false);
    await pressQuestion();
    await wrapper.get('dialog').trigger('cancel');
    expect(dialog.open).toBe(false);
    await pressQuestion();
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, right: 600, bottom: 600 });
    await wrapper.get('dialog').trigger('click', { clientX: 150, clientY: 150 });
    expect(dialog.open).toBe(true);
    await wrapper.get('dialog').trigger('click', { clientX: 20, clientY: 20 });
    expect(dialog.open).toBe(false);
  });
  it.each(['[aria-label="Headline text"]', '[aria-label="Time within chapter"]', '[aria-label="Chapter 1 title"]'])(
    'does not intercept ? typed in %s', async selector => {
      wrapper.get(selector).element.focus();
      const event = await pressQuestion();
      expect(event.defaultPrevented).toBe(false);
      expect(dialog.open).toBe(false);
    });
  it('ignores editable content and selectors', async () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    editable.tabIndex = 0;
    document.body.append(editable);
    try {
      editable.focus();
      expect((await pressQuestion()).defaultPrevented).toBe(false);
      expect(dialog.open).toBe(false);
    } finally { editable.remove(); }
    await wrapper.get('#settings-tab').trigger('click');
    wrapper.get('#outputFPS').element.focus();
    expect((await pressQuestion()).defaultPrevented).toBe(false);
    expect(dialog.open).toBe(false);
  });
  it('ignores modifier shortcuts, IME composition and repeated keydown events', async () => {
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }]) {
      await pressQuestion(options);
      expect(dialog.open).toBe(false);
    }
    await pressQuestion();
    await pressQuestion({ repeat: true });
    expect(dialog.open).toBe(true);
  });
  it('does not play, save, undo or navigate headlines behind the open help', async () => {
    await editTitle(1, 'Keep this title');
    const timeBefore = wrapper.get('#scrub').element.value;
    wrapper.get('#btnShortcuts').element.focus();
    await pressQuestion();
    for (const options of [{ key: ' ', code: 'Space' }, { key: 's', ctrlKey: true },
      { key: 'z', ctrlKey: true }, { key: '.' }, { key: ',' }]) {
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options }));
    }
    await nextTick();
    expect(wrapper.get('#btnPlay').text()).toBe('Play');
    expect(wrapper.get('#scrub').element.value).toBe(timeBefore);
    expect(wrapper.get('[aria-label="Chapter 1 title"]').element.value).toBe('Keep this title');
    expect(downloadJSON).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
  });
  it('surfaces failures to open the dialog', async () => {
    dialog.showModal.mockImplementation(() => { throw new Error('Dialog unavailable'); });
    await pressQuestion();
    expect(dialog.open).toBe(false);
    expect(wrapper.get('#toast').text()).toContain('Could not show keyboard shortcuts: Dialog unavailable');
  });
});

describe('Vue preview and time inputs', () => {
  it('reactively centers scrolling chapters and clamps the end', async () => {
    const state = fromJSON({
      chapters: Array.from({ length: 12 }, (_, i) => `Chapter ${i + 1}`),
      chapter_starts: Array.from({ length: 12 }, (_, i) => [i * 2, i + 1]),
      headlines: [[0, 'Demo']],
    });
    const preview = mount(Preview, { props: { state, cur: 12.4, headlinePx: 70, pillPx: 28, productPx: 56 } });
    const active = preview.get('.pill.on');
    expect(active.text()).toBe('Chapter 7');
    expect(active.element.style.top).toBe('252px');
    expect(preview.get('#chapterCounter').text()).toBe('Chapter 7 of 12');
    await preview.setProps({ cur: 12.2 });
    expect(parseFloat(preview.get('.pill.on').element.style.top)).toBeCloseTo(315);
    await preview.setProps({ cur: 22.4 });
    expect(preview.get('.pill.on').element.style.top).toBe('630px');
    expect(preview.find('#chaptersBelow').exists()).toBe(false);
    await preview.setProps({ cur: 0 });
    expect(preview.find('#chaptersAbove').exists()).toBe(false);
    preview.unmount();
  });
  it('commits timecode and keyboard nudges with explicit invalid-input feedback', async () => {
    const time = mount(TimeInput, { props: { modelValue: 0, offset: 3600 } });
    await time.get('input').setValue('1:03:44');
    expect(time.emitted('update:modelValue')[0]).toEqual([224]);
    await time.setProps({ modelValue: 224 });
    await time.get('input').trigger('keydown', { key: 'ArrowUp', altKey: true });
    expect(time.emitted('update:modelValue').at(-1)).toEqual([224.1]);
    await time.get('input').setValue('invalid');
    expect(time.emitted('error')).toHaveLength(1);
    await nextTick();
    expect(time.get('input').element.value).toBe('3:44');
    time.unmount();
  });
  it('converts absolute timecode to chapter-relative time, including an out-of-chapter warning value', async () => {
    const time = mount(TimeInput, { props: { modelValue: -5, offset: 3660, relative: true } });
    expect(time.get('input').element.value).toBe('-0:05');
    expect(time.get('input').attributes('title')).toBe('01:00:55');
    await time.get('input').setValue('01:01:03');
    expect(time.emitted('update:modelValue')[0]).toEqual([3]);
    await time.get('input').setValue('01:00:55');
    expect(time.emitted('update:modelValue')[1]).toEqual([-5]);
    expect(time.get('input').element.value).toBe('-0:05');
    time.unmount();
  });
});
