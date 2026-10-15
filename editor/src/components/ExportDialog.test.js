import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExportDialog from './ExportDialog.vue';
import { canChooseLocation, chooseLocation, getInfo, removeJob, runExport, saveVideo } from '../exporter.js';

vi.mock('../exporter.js', async importOriginal => ({
  ...(await importOriginal()),
  getInfo: vi.fn(), runExport: vi.fn(), saveVideo: vi.fn(), removeJob: vi.fn(), chooseLocation: vi.fn(), canChooseLocation: vi.fn(),
}));

const INFO = { ok: true, encoders: { libx264: true, h264_videotoolbox: true } };
const clip = (name, start = 0) => ({ id: name + start, media_id: name, name, start, dur: 10 });
const linked = (...names) => new Map(names.map(name => [name, new File(['x'], name)]));
const mountDialog = async (props = {}) => {
  const wrapper = mount(ExportDialog, { props: { clips: [clip('demo.mp4')], files: linked('demo.mp4'),
    getProject: () => '{"project_version":1}', title: 'My Demo', duration: 75, ...props }, attachTo: document.body });
  await flushPromises();
  return wrapper;
};

describe('Export dialog', () => {
  beforeEach(() => { vi.clearAllMocks(); getInfo.mockResolvedValue(INFO); canChooseLocation.mockReturnValue(true); });

  it('explains how to start the service when it is not running, and can check again', async () => {
    getInfo.mockResolvedValue(null);
    const wrapper = await mountDialog();
    expect(wrapper.get('#exportUnavailable').text()).toContain('render/server.py');
    expect(wrapper.find('#exportStart').exists()).toBe(false);
    getInfo.mockResolvedValue(INFO);
    await wrapper.get('#exportRetry').trigger('click');
    await flushPromises();
    expect(wrapper.find('#exportStart').exists()).toBe(true);
    wrapper.unmount();
  });

  it('offers the project sizes in a dropdown starting at the project setting, and warns that 4K is slower', async () => {
    const wrapper = await mountDialog();
    const options = wrapper.findAll('#exportResolution option');
    expect(options.map(o => o.element.value)).toEqual(['3840x2160', '2560x1440', '1920x1080', '1280x720', '960x540', '640x360']);
    expect(wrapper.get('#exportResolution').element.value).toBe('1920x1080');
    expect(options[0].text()).toContain('4K');
    expect(options[2].text()).toContain('project setting');
    expect(wrapper.get('[data-quality="standard"]').attributes('aria-checked')).toBe('true');
    expect(wrapper.get('#exportSpeed').text()).toContain('as fast as');
    await wrapper.get('#exportResolution').setValue('3840x2160');
    expect(wrapper.get('#exportSpeed').text()).toMatch(/4\.0× slower/);
    expect(wrapper.get('#resHint').text()).toContain('Upscaled');
    expect(wrapper.text()).toContain('3840 × 2160');
    wrapper.unmount();
  });

  it('starts at the project resolution, including a custom one that is not in the list', async () => {
    const wrapper = await mountDialog({ resolution: '1600x900' });
    expect(wrapper.get('#exportResolution').element.value).toBe('1600x900');
    expect(wrapper.findAll('#exportResolution option')[0].element.value).toBe('1600x900');
    wrapper.unmount();
  });

  it('will not start while a video the project uses is not linked, and says which', async () => {
    const wrapper = await mountDialog({ clips: [clip('a.mp4'), clip('b.mp4', 20)], files: linked('a.mp4') });
    expect(wrapper.get('#exportMissing').text()).toContain('b.mp4');
    expect(wrapper.get('#exportStart').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('needs a video and a file name before it will start', async () => {
    const empty = await mountDialog({ clips: [], files: new Map() });
    expect(empty.find('#exportNoVideo').exists()).toBe(true);
    expect(empty.get('#exportStart').attributes('disabled')).toBeDefined();
    empty.unmount();
    const wrapper = await mountDialog();
    expect(wrapper.get('#exportName').element.value).toBe('my-demo');
    await wrapper.get('#exportName').setValue('  ');
    expect(wrapper.get('#exportStart').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('only offers the hardware encoder when the service has one', async () => {
    const wrapper = await mountDialog();
    expect(wrapper.find('#exportFast').exists()).toBe(true);
    wrapper.unmount();
    getInfo.mockResolvedValue({ ok: true, encoders: { libx264: true, h264_videotoolbox: false } });
    const without = await mountDialog();
    expect(without.find('#exportFast').exists()).toBe(false);
    without.unmount();
  });

  it('sends the chosen options, shows progress, then lets you save the finished video', async () => {
    let finish;
    runExport.mockImplementation(({ onUpdate }) => new Promise(resolve => {
      onUpdate({ phase: 'rendering', fraction: 0.42, message: 'Rendering', fps: 12.4, eta: 125 });
      finish = () => resolve({ job: 'j1', token: 't', view: { filename: 'my-demo.mp4', size: 52_000_000 } });
    }));
    const wrapper = await mountDialog({ clips: [clip('a.mp4'), clip('b.mp4', 20)], files: linked('a.mp4', 'b.mp4') });
    await wrapper.get('#exportResolution').setValue('3840x2160');
    await wrapper.get('[data-quality="high"]').trigger('click');
    await wrapper.get('#exportFast').setValue(true);
    expect(wrapper.text()).toContain('2 videos');
    await wrapper.get('#exportStart').trigger('click');
    await flushPromises();
    const call = runExport.mock.calls[0][0];
    expect(call).toMatchObject({ size: '3840x2160', quality: 'high', fast: true, filename: 'my-demo', project: '{"project_version":1}' });
    expect([...call.files.keys()]).toEqual(['a.mp4', 'b.mp4']);
    const running = wrapper.get('#exportRunning');
    expect(running.text()).toContain('Rendering');
    expect(running.text()).toContain('42%');
    expect(running.text()).toContain('12 frames/s');
    expect(running.text()).toContain('2m 5s left');
    expect(wrapper.get('[role=progressbar]').attributes('aria-valuenow')).toBe('42');
    expect(wrapper.get('.export-x').attributes('disabled')).toBeDefined();         // cannot close mid-export
    finish();
    await flushPromises();
    expect(wrapper.get('#exportDone').text()).toContain('52 MB');
    saveVideo.mockResolvedValue({ name: 'final.mp4', where: 'the location you chose' });
    await wrapper.get('#exportSave').trigger('click');
    await flushPromises();
    expect(saveVideo).toHaveBeenCalledWith({ job: 'j1', token: 't', view: expect.any(Object) }, 'my-demo.mp4',
      { target: null, startIn: null });
    expect(wrapper.get('#exportSaved').text()).toBe('Saved as final.mp4 in the location you chose.');
    wrapper.unmount();
    expect(removeJob).toHaveBeenCalledWith('j1');                                    // working files are cleaned up
  });

  it('lets you choose where the file goes before rendering, opens the picker in the project folder, and saves there when done', async () => {
    const startIn = { kind: 'directory', name: 'my-demo' };
    const picked = { name: 'chosen.mp4' };
    chooseLocation.mockResolvedValue(picked);
    runExport.mockResolvedValue({ job: 'j1', token: 't', view: { filename: 'my-demo.mp4', size: 5_000_000 } });
    saveVideo.mockResolvedValue({ name: 'chosen.mp4', where: 'the location you chose' });
    const wrapper = await mountDialog({ startIn });
    expect(wrapper.get('#exportTarget').text()).toContain('starting in your project folder');
    await wrapper.get('#exportChoose').trigger('click');
    expect(chooseLocation).toHaveBeenCalledWith('my-demo.mp4', startIn);
    expect(wrapper.get('#exportTarget').text()).toBe('chosen.mp4');
    await wrapper.get('#exportStart').trigger('click');
    await flushPromises();
    expect(saveVideo).toHaveBeenCalledWith(expect.any(Object), 'my-demo.mp4', { target: picked, startIn });   // no second prompt
    expect(wrapper.get('#exportSaved').text()).toContain('chosen.mp4');
    wrapper.unmount();
  });

  it('keeps the finished video and shows the reason when the chosen file cannot be written', async () => {
    chooseLocation.mockResolvedValue({ name: 'locked.mp4' });
    runExport.mockResolvedValue({ job: 'j1', token: 't', view: { filename: 'my-demo.mp4', size: 5_000_000 } });
    saveVideo.mockRejectedValue(new Error('Permission denied'));
    const wrapper = await mountDialog();
    await wrapper.get('#exportChoose').trigger('click');
    await wrapper.get('#exportStart').trigger('click');
    await flushPromises();
    expect(wrapper.get('#exportSaveError').text()).toContain('Permission denied');
    expect(wrapper.find('#exportSave').exists()).toBe(true);                 // can still save it somewhere else
    wrapper.unmount();
  });

  it('says the video goes to Downloads when the browser cannot choose a location', async () => {
    canChooseLocation.mockReturnValue(false);
    const wrapper = await mountDialog();
    expect(wrapper.find('#exportChoose').exists()).toBe(false);
    expect(wrapper.get('#exportTarget').text()).toContain('Downloads');
    wrapper.unmount();
  });

  it('cancelling goes back to the form', async () => {
    runExport.mockImplementation(({ signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
    }));
    const wrapper = await mountDialog();
    await wrapper.get('#exportStart').trigger('click');
    await flushPromises();
    await wrapper.get('#exportCancel').trigger('click');
    await flushPromises();
    expect(wrapper.find('#exportStart').exists()).toBe(true);
    expect(wrapper.find('#exportError').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows what went wrong and lets you go back', async () => {
    runExport.mockRejectedValue(new Error('Encoding failed: disk full'));
    const wrapper = await mountDialog();
    await wrapper.get('#exportStart').trigger('click');
    await flushPromises();
    expect(wrapper.get('#exportError').text()).toContain('disk full');
    await wrapper.get('#exportError .primary').trigger('click');
    expect(wrapper.find('#exportStart').exists()).toBe(true);
    wrapper.unmount();
  });

  it('reports an invalid project instead of starting', async () => {
    const wrapper = await mountDialog({ getProject: () => { throw new Error('Each chapter must have a start'); } });
    await wrapper.get('#exportStart').trigger('click');
    await flushPromises();
    expect(runExport).not.toHaveBeenCalled();
    expect(wrapper.get('#exportError').text()).toContain('Each chapter must have a start');
    wrapper.unmount();
  });

  it('closes with Escape or the backdrop, but not while running', async () => {
    const wrapper = await mountDialog();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toHaveLength(1);
    await wrapper.get('.export-overlay').trigger('mousedown');
    expect(wrapper.emitted('close')).toHaveLength(2);
    wrapper.unmount();
  });
});
