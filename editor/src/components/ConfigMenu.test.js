import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import ConfigMenu from './ConfigMenu.vue';

let wrapper;
afterEach(() => wrapper?.unmount());
const mountMenu = () => {
  wrapper = mount(ConfigMenu, { attachTo: document.body, slots: { default: '<input id="inside">' } });
  const element = dialog().element;
  element.showModal = vi.fn(() => { element.open = true; });
  element.close = vi.fn(() => { element.open = false; element.dispatchEvent(new Event('close')); });
  return wrapper;
};
const dialog = () => wrapper.get('#config-menu');

describe('config menu', () => {
  it('is closed until the gear is clicked, and the gear says so', async () => {
    mountMenu();
    expect(dialog().isVisible()).toBe(false);
    expect(wrapper.get('.config-button').attributes('aria-expanded')).toBe('false');
    await wrapper.get('.config-button').trigger('click');
    expect(dialog().isVisible()).toBe(true);
    expect(wrapper.get('.config-button').attributes('aria-expanded')).toBe('true');
    expect(dialog().element.showModal).toHaveBeenCalledOnce();
    expect(dialog().attributes('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dialog().element);
  });
  it('closes with the gear, the close button and Escape, returning focus to the gear', async () => {
    mountMenu();
    const gear = wrapper.get('.config-button');
    await gear.trigger('click');
    await gear.trigger('click');
    expect(dialog().isVisible()).toBe(false);
    await gear.trigger('click');
    await wrapper.get('[aria-label="Close settings"]').trigger('click');
    expect(dialog().isVisible()).toBe(false);
    expect(document.activeElement).toBe(gear.element);
    await gear.trigger('click');
    await dialog().trigger('keydown', { key: 'Escape' });
    expect(dialog().isVisible()).toBe(false);
    expect(document.activeElement).toBe(gear.element);
  });
  it('stays open for clicks inside it, including padding, and closes on the backdrop', async () => {
    mountMenu();
    await wrapper.get('.config-button').trigger('click');
    vi.spyOn(dialog().element, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 500, 500));
    await wrapper.get('#inside').trigger('click');
    expect(dialog().isVisible()).toBe(true);
    await dialog().trigger('click', { clientX: 150, clientY: 150 });
    expect(dialog().isVisible()).toBe(true);
    await dialog().trigger('click', { clientX: 50, clientY: 50 });
    expect(dialog().isVisible()).toBe(false);
    expect(document.activeElement).toBe(wrapper.get('.config-button').element);
  });
  it('handles native cancel and externally controlled open state', async () => {
    mountMenu();
    await wrapper.setProps({ open: true });
    expect(dialog().element.open).toBe(true);
    await dialog().trigger('cancel');
    expect(dialog().element.open).toBe(false);
    expect(wrapper.emitted('update:open').at(-1)).toEqual([false]);
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    expect(dialog().element.open).toBe(true);
    await wrapper.setProps({ open: false });
    expect(dialog().element.open).toBe(false);
  });
  it('reports modal failures instead of leaving the gear expanded', async () => {
    mountMenu();
    dialog().element.showModal.mockImplementation(() => { throw new Error('Dialog unavailable'); });
    await wrapper.get('.config-button').trigger('click');
    await nextTick();
    expect(wrapper.emitted('error')).toEqual([['Could not show project settings: Dialog unavailable']]);
    expect(wrapper.get('.config-button').attributes('aria-expanded')).toBe('false');
  });
  it('keeps settings key presses from triggering editor shortcuts', async () => {
    mountMenu();
    const listener = vi.fn();
    document.addEventListener('keydown', listener);
    try {
      await wrapper.get('.config-button').trigger('click');
      await dialog().trigger('keydown', { key: ' ', code: 'Space' });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', listener);
    }
  });
  it('keeps what you typed while closed', async () => {
    mountMenu();
    await wrapper.get('.config-button').trigger('click');
    wrapper.get('#inside').element.value = 'kept';
    await wrapper.get('.config-button').trigger('click');
    expect(wrapper.get('#inside').element.value).toBe('kept');
  });
});
