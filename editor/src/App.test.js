import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';
import Preview from './components/Preview.vue';
import TimeInput from './components/TimeInput.vue';
import { DEFAULT, fromJSON } from './timing.js';
import { downloadJSON, rememberHandle, rememberedHandle } from './fileAccess.js';

vi.mock('./fileAccess.js', () => ({
  downloadJSON: vi.fn(),
  rememberHandle: vi.fn().mockResolvedValue(),
  rememberedHandle: vi.fn().mockResolvedValue(null),
  pickerOptions: {},
}));

let wrapper;
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
  const input = wrapper.get(`#names input[data-chapter="${ch}"]`);
  await input.trigger('focus');
  await input.setValue(text);
}
async function openLinkedFile(data = DEFAULT) {
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
  it('renders sample chapters, headlines, accents and timeline', () => {
    expect(wrapper.findAll('#stage .pill')).toHaveLength(6);
    expect(wrapper.findAll('#headlines .row')).toHaveLength(12);
    expect(wrapper.findAll('#tl .band')).toHaveLength(6);
    expect(wrapper.get('#hl b').text()).toBe('Kubernetes,');
  });
  it('adds custom chapters beyond six and synchronizes all titles', async () => {
    for (let i = 0; i < 6; i++) await wrapper.get('#addChapter').trigger('click');
    await editTitle(12, 'A custom chapter');
    expect(wrapper.findAll('#stage .pill')).toHaveLength(12);
    expect(wrapper.findAll('#stage .pill').at(-1).text()).toBe('A custom chapter');
    expect(wrapper.get('#names input[data-chapter="12"]').element.value).toBe('A custom chapter');
    expect(wrapper.findAll('#chapters select').every(s => s.text().includes('A custom chapter'))).toBe(true);
    expect(wrapper.get('#chapterCounter').text()).toContain('of 12');
  });
  it('deletes middle chapters, renumbers, and restores them with undo', async () => {
    await wrapper.findAll('#chapters .crow')[2].get('button').trigger('click');
    expect(wrapper.findAll('#stage .pill')).toHaveLength(5);
    expect(wrapper.findAll('#stage .pill')[2].text()).toBe('SUSE Security');
    expect(wrapper.findAll('#chapters select')[2].element.value).toBe('3');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.findAll('#stage .pill')).toHaveLength(6);
    expect(wrapper.findAll('#stage .pill')[2].text()).toBe('SUSE Virtualization');
  });
  it('matches preview, editor and saved chapter order after moving a chapter', async () => {
    const time = wrapper.findAll('#chapters .time')[2];
    await time.trigger('focus');
    await time.setValue('0:10');
    const orderedTitles = [DEFAULT.chapters[0], DEFAULT.chapters[2], DEFAULT.chapters[1], ...DEFAULT.chapters.slice(3)];
    expect(wrapper.findAll('#stage .pill').map(pill => pill.text())).toEqual(orderedTitles);
    expect(wrapper.findAll('#chapters select').map(select => select.element.selectedOptions[0].textContent.trim()))
      .toEqual(orderedTitles.map((title, i) => `${i + 1} ${title}`));
    expect(wrapper.get('.pill.on').text()).toBe(DEFAULT.chapters[2]);
    await wrapper.get('#btnDownload').trigger('click');
    const saved = JSON.parse(downloadJSON.mock.calls[0][0]);
    expect(saved.chapters).toEqual(orderedTitles);
    expect(saved.chapter_starts.slice(0, 3)).toEqual([[0, 1], [10, 2], [30, 3]]);
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.findAll('#stage .pill').map(pill => pill.text())).toEqual(DEFAULT.chapters);
  });
  it('inserts a new chapter at the playhead and focuses its remapped title', async () => {
    await wrapper.get('#scrub').setValue('15');
    await wrapper.get('#addChapter').trigger('click');
    expect(wrapper.findAll('#stage .pill')[1].text()).toBe('New chapter');
    const input = wrapper.get('#names input[data-chapter="2"]');
    expect(wrapper.get('.names-details').element.open).toBe(true);
    expect(document.activeElement).toBe(input.element);
    await input.setValue('Inserted chapter');
    expect(wrapper.findAll('#stage .pill')[1].text()).toBe('Inserted chapter');
    expect(wrapper.get('#names input[data-chapter="2"]').element.value).toBe('Inserted chapter');
  });
  it('reorders by first appearance when a repeated switch is deleted', async () => {
    await openLinkedFile({
      ...DEFAULT, chapters: ['Intro', 'Details', 'Wrap up'],
      chapter_starts: [[0, 1], [10, 2], [20, 3], [30, 2]],
    });
    await wrapper.findAll('#chapters .crow')[1].get('button').trigger('click');
    expect(wrapper.findAll('#stage .pill').map(pill => pill.text())).toEqual(['Intro', 'Wrap up', 'Details']);
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls[0][0]).chapter_starts).toEqual([[0, 1], [20, 2], [30, 3]]);
  });
  it('keeps the button when a repeated switch is deleted', async () => {
    await wrapper.get('#addChapterSwitch').trigger('click');
    await wrapper.findAll('#chapters select')[1].setValue('1');
    await wrapper.findAll('#chapters .crow')[1].get('button').trigger('click');
    expect(wrapper.findAll('#stage .pill')).toHaveLength(6);
  });
  it('updates metadata and Names through extracted component events with undo', async () => {
    const product = wrapper.get('#productIn');
    await product.trigger('focus');
    await product.setValue('Updated product');
    expect(wrapper.get('#prodname').text()).toBe('Updated product');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.get('#prodname').text()).toBe(DEFAULT.product_name);
    const title = wrapper.get('#names input[data-chapter="2"]');
    await title.trigger('focus');
    await title.setValue('Shared updated title');
    expect(wrapper.findAll('#chapters select')[1].element.selectedOptions[0].textContent).toContain('Shared updated title');
    expect(wrapper.findAll('#stage .pill')[1].text()).toBe('Shared updated title');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.findAll('#stage .pill')[1].text()).toBe(DEFAULT.chapters[1]);
  });
  it('forwards row time edits and playhead actions with undo', async () => {
    const time = wrapper.findAll('#chapters .time')[1];
    await time.trigger('focus');
    await time.setValue('0:35');
    expect(wrapper.findAll('#chapters .time')[1].element.value).toBe('0:35');
    expect(wrapper.get('#status').text()).toContain('unsaved');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.findAll('#chapters .time')[1].element.value).toBe('0:30');
    await wrapper.get('#scrub').setValue('7');
    await wrapper.get('#headlines button[title="Set time to the playhead"]').trigger('click');
    expect(wrapper.get('#headlines .time').element.value).toBe('0:07');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.get('#headlines .time').element.value).toBe('0:00');
  });
  it('keeps at least one chapter and headline', async () => {
    while (wrapper.findAll('#chapters .crow').length > 1) {
      await wrapper.findAll('#chapters .crow').at(-1).get('button').trigger('click');
    }
    await wrapper.get('#chapters .crow button').trigger('click');
    expect(wrapper.findAll('#stage .pill')).toHaveLength(1);
    expect(wrapper.get('#toast').text()).toContain('Keep at least one');
    while (wrapper.findAll('#headlines .row').length > 1) {
      await wrapper.findAll('#headlines .row').at(-1).get('button[title="Delete"]').trigger('click');
    }
    await wrapper.get('#headlines button[title="Delete"]').trigger('click');
    expect(wrapper.get('#toast').text()).toBe('Keep at least one headline');
  });
  it('edits headlines, adds with Enter, and applies ripple with undo', async () => {
    const text = wrapper.get('#headlines input:not(.time)');
    await text.trigger('focus');
    await text.setValue('A *new accent* headline');
    expect(wrapper.get('#hl').text()).toBe('A new accent headline');
    expect(wrapper.findAll('#hl b')).toHaveLength(2);
    await text.trigger('keydown', { key: 'Enter' });
    expect(wrapper.findAll('#headlines .row')).toHaveLength(13);
    await wrapper.get('#scrub').setValue('30');
    await wrapper.get('#rippleBy').setValue('-5');
    await wrapper.get('#btnRipple').trigger('click');
    expect(wrapper.findAll('#chapters .time')[1].element.value).toBe('0:25');
    await wrapper.get('#btnUndo').trigger('click');
    expect(wrapper.findAll('#chapters .time')[1].element.value).toBe('0:30');
  });
  it('links, remembers, saves and autosaves files without a backend', async () => {
    const { writable } = await openLinkedFile();
    expect(rememberHandle).toHaveBeenCalled();
    await editTitle(1, 'Renamed');
    await wrapper.get('#btnSave').trigger('click');
    await flushPromises();
    expect(JSON.parse(writable.write.mock.calls[0][0]).chapters[0]).toBe('Renamed');
    expect(wrapper.get('#status').text()).toBe('saved to linked.json');
    vi.useFakeTimers();
    await editTitle(1, 'Autosaved');
    await vi.advanceTimersByTimeAsync(700);
    await flushPromises();
    expect(JSON.parse(writable.write.mock.calls.at(-1)[0]).chapters[0]).toBe('Autosaved');
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
    expect(JSON.parse(writable.write.mock.calls[0][0]).chapters[0]).toBe('New file title');
    expect(rememberHandle).toHaveBeenCalledWith(fileHandle);
    expect(wrapper.get('#status').text()).toBe('saved to new.json');
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
      getFile: vi.fn().mockResolvedValue({ text: async () => JSON.stringify({ ...DEFAULT, title: 'Remembered title' }) }),
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
    fileHandle.getFile.mockResolvedValue({ text: async () => JSON.stringify(changed) });
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(wrapper.findAll('#stage .pill')[0].text()).toBe('Changed externally');
    await editTitle(1, 'Local unsaved edit');
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(wrapper.findAll('#stage .pill')[0].text()).toBe('Local unsaved edit');
  });
  it('downloads the renderer-compatible JSON schema', async () => {
    await editTitle(1, 'Download me');
    await wrapper.get('#btnDownload').trigger('click');
    expect(JSON.parse(downloadJSON.mock.calls[0][0])).toMatchObject({
      schema_version: 1, chapters: ['Download me', ...DEFAULT.chapters.slice(1)],
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
    const file = { text: async () => JSON.stringify({ ...DEFAULT, title: 'Fallback file' }), name: 'fallback.json' };
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
    await input.trigger('change');
    await flushPromises();
    expect(wrapper.get('#titleIn').element.value).toBe('Fallback file');
    expect(wrapper.get('#toast').text()).toContain('use Download');
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
});
