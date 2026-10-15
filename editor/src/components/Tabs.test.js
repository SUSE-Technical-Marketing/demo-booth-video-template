import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import TabGroup from './TabGroup.vue';
import TabPane from './TabPane.vue';

let wrapper;
const tabs = [
  { id: 'first', label: 'First' },
  { id: 'second', label: 'Second' },
  { id: 'third', label: 'Third' },
];
beforeEach(() => {
  wrapper = mount(TabGroup, {
    attachTo: document.body,
    props: { tabs, label: 'Test sections', modelValue: 'first' },
    slots: { first: '<input aria-label="Draft">', second: '<p>Second content</p>', third: '<p>Third content</p>' },
  });
});
afterEach(() => wrapper.unmount());

describe('reusable tabs', () => {
  it('links tab controls and panels and exposes only the active panel', () => {
    expect(wrapper.get('[role=tablist]').attributes('aria-label')).toBe('Test sections');
    expect(wrapper.findAllComponents(TabPane)).toHaveLength(3);
    for (const tab of tabs) {
      const button = wrapper.get(`#${tab.id}-tab`), panel = wrapper.get(`#${tab.id}-panel`);
      expect(button.attributes('aria-controls')).toBe(panel.attributes('id'));
      expect(panel.attributes('aria-labelledby')).toBe(button.attributes('id'));
      expect(panel.isVisible()).toBe(tab.id === 'first');
      expect(button.attributes('tabindex')).toBe(tab.id === 'first' ? '0' : '-1');
    }
  });
  it('emits controlled selection and preserves mounted content and drafts on external changes', async () => {
    const input = wrapper.get('input');
    await input.setValue('Unfinished draft');
    await wrapper.get('#third-tab').trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([['third']]);
    await wrapper.setProps({ modelValue: 'third' });
    expect(wrapper.get('#third-panel').isVisible()).toBe(true);
    expect(wrapper.get('#first-panel').isVisible()).toBe(false);
    await wrapper.setProps({ modelValue: 'first' });
    expect(wrapper.get('input').element).toBe(input.element);
    expect(wrapper.get('input').element.value).toBe('Unfinished draft');
  });
  it('navigates more than two tabs, wraps both ways, and supports Home and End', async () => {
    for (const [from, key, target] of [
      ['first', 'ArrowRight', 'second'], ['second', 'ArrowRight', 'third'],
      ['third', 'ArrowRight', 'first'], ['first', 'ArrowLeft', 'third'],
      ['third', 'Home', 'first'], ['first', 'End', 'third'],
    ]) {
      await wrapper.setProps({ modelValue: from });
      await wrapper.get(`#${from}-tab`).trigger('keydown', { key });
      expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([target]);
      expect(document.activeElement).toBe(wrapper.get(`#${target}-tab`).element);
    }
    const count = wrapper.emitted('update:modelValue').length;
    await wrapper.get('#first-tab').trigger('keydown', { key: 'Tab' });
    expect(wrapper.emitted('update:modelValue')).toHaveLength(count);
  });
});
