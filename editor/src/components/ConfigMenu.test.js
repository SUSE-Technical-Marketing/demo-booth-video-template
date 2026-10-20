import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import ConfigMenu from './ConfigMenu.vue';

let wrapper;
afterEach(() => wrapper?.unmount());
const mountMenu = () => {
  wrapper = mount(ConfigMenu, { attachTo: document.body, slots: { default: '<input id="inside">' } });
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
  it('stays open for clicks inside it and closes for clicks outside', async () => {
    mountMenu();
    await wrapper.get('.config-button').trigger('click');
    wrapper.get('#inside').element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await nextTick();
    expect(dialog().isVisible()).toBe(true);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await nextTick();
    expect(dialog().isVisible()).toBe(false);
  });
  it('keeps what you typed while closed', async () => {
    mountMenu();
    await wrapper.get('.config-button').trigger('click');
    wrapper.get('#inside').element.value = 'kept';
    await wrapper.get('.config-button').trigger('click');
    expect(wrapper.get('#inside').element.value).toBe('kept');
  });
});
