import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ZipImport from './ZipImport.vue';

let wrapper, openProject;
beforeEach(() => {
  openProject = vi.fn().mockResolvedValue(true);
  wrapper = mount(ZipImport, { props: { openProject }, attachTo: document.body });
  const dialog = wrapper.get('dialog').element;
  dialog.showModal = vi.fn(() => { dialog.open = true; });
  dialog.close = vi.fn(() => { dialog.open = false; });
  wrapper.vm.show();
});
afterEach(() => wrapper.unmount());

describe('ZIP import dialog', () => {
  it('imports the chosen local ZIP and closes only after a successful install', async () => {
    const file = new File(['zip'], 'project.zip'), input = wrapper.get('#zipFile');
    Object.defineProperty(input.element, 'files', { value: [file] });
    await input.trigger('change');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(openProject).toHaveBeenCalledWith(file, { signal: expect.any(AbortSignal), onProgress: expect.any(Function) });
    expect(wrapper.vm.isOpen).toBe(false);
  });
  it('imports URL text and displays progress while controls are disabled', async () => {
    const pending = Promise.withResolvers();
    openProject.mockImplementation((_, options) => {
      options.onProgress({ phase: 'Downloading ZIP', bytes: 1048576, total: 2097152 });
      return pending.promise;
    });
    await wrapper.get('input[value=url]').setValue(true);
    await wrapper.get('#zipUrl').setValue('https://files.example/demo.zip');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('fieldset').element.disabled).toBe(true);
    expect(wrapper.get('progress').element.value).toBe(1048576);
    expect(wrapper.get('.zip-progress').text()).toContain('1.0 MB / 2.0 MB');
    pending.resolve(true);
    await flushPromises();
    expect(wrapper.vm.isOpen).toBe(false);
  });
  it('surfaces import failures and leaves the dialog available for retry', async () => {
    openProject.mockRejectedValue(new Error('Not enough browser storage'));
    await wrapper.get('input[value=url]').setValue(true);
    await wrapper.get('#zipUrl').setValue('https://files.example/demo.zip');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role=alert]').text()).toContain('Not enough browser storage');
    expect(wrapper.emitted('error')[0][0]).toBeInstanceOf(Error);
    expect(wrapper.vm.isOpen).toBe(true);
    expect(wrapper.get('#btnImportZip').element.disabled).toBe(false);
  });
  it('cancels active work on Escape without reporting an import error', async () => {
    let signal;
    openProject.mockImplementation((_, options) => new Promise((resolve, reject) => {
      signal = options.signal;
      signal.addEventListener('abort', () => reject(signal.reason));
    }));
    await wrapper.get('input[value=url]').setValue(true);
    await wrapper.get('#zipUrl').setValue('https://files.example/demo.zip');
    await wrapper.get('form').trigger('submit');
    await wrapper.get('dialog').trigger('cancel');
    await flushPromises();
    expect(signal.aborted).toBe(true);
    expect(wrapper.vm.isOpen).toBe(false);
    expect(wrapper.emitted('error')).toBeUndefined();
  });
  it('does not abort the installed project when the dialog is reopened and cancelled', async () => {
    await wrapper.get('input[value=url]').setValue(true);
    await wrapper.get('#zipUrl').setValue('https://files.example/demo.zip');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const signal = openProject.mock.calls[0][1].signal;
    wrapper.vm.show();
    await wrapper.get('dialog').trigger('cancel');
    expect(signal.aborted).toBe(false);
  });
  it('does not reuse a stale file after switching from file to URL and back', async () => {
    const input = wrapper.get('#zipFile');
    Object.defineProperty(input.element, 'files', { value: [new File(['zip'], 'old.zip')] });
    await input.trigger('change');
    await wrapper.get('input[value=url]').setValue(true);
    await wrapper.get('input[value=file]').setValue(true);
    await wrapper.get('form').trigger('submit');
    expect(openProject).not.toHaveBeenCalled();
    expect(wrapper.get('[role=alert]').text()).toContain('Choose a ZIP');
  });
});
