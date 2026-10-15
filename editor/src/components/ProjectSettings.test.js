import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ProjectSettings from './ProjectSettings.vue';

let wrapper;
beforeEach(() => {
  wrapper = mount(ProjectSettings, { props: {
    title: 'Demo', productName: 'SUSE', headlineEnd: null, wipeSeconds: 0.8, cur: 65, rippleBy: -5,
  } });
});
afterEach(() => wrapper.unmount());

describe('project settings', () => {
  it('renders settings and reflects document and playhead changes', async () => {
    expect(wrapper.get('#titleIn').element.value).toBe('Demo');
    expect(wrapper.get('#productIn').element.value).toBe('SUSE');
    expect(wrapper.get('#endAt').element.value).toBe('');
    expect(wrapper.get('#rippleAt').text()).toBe('1:05');
    await wrapper.setProps({ headlineEnd: 90, cur: 120, wipeSeconds: 1.2 });
    expect(wrapper.get('#endAt').element.value).toBe('1:30');
    expect(wrapper.get('#rippleAt').text()).toBe('2:00');
    expect(wrapper.get('#wipe').element.value).toBe('1.2');
  });
  it('emits metadata edits without changing the supplied document values', async () => {
    await wrapper.get('#titleIn').trigger('focus');
    await wrapper.get('#titleIn').setValue('Updated');
    await wrapper.get('#productIn').trigger('focus');
    await wrapper.get('#productIn').setValue('New product');
    expect(wrapper.emitted('begin-edit')).toHaveLength(2);
    expect(wrapper.emitted('update-metadata')).toEqual([['title', 'Updated'], ['product_name', 'New product']]);
    expect(wrapper.props('title')).toBe('Demo');
  });
  it('forwards timing events so the app can validate and restore invalid input', async () => {
    await wrapper.get('#endAt').setValue('invalid');
    const endEvent = wrapper.emitted('change-end')[0][0];
    expect(endEvent.target).toBe(wrapper.get('#endAt').element);
    endEvent.target.value = '1:30';
    expect(wrapper.get('#endAt').element.value).toBe('1:30');
    await wrapper.get('#wipe').setValue('-1');
    expect(wrapper.emitted('change-wipe')[0][0].target).toBe(wrapper.get('#wipe').element);
  });
  it('keeps the ripple input controlled and emits apply separately', async () => {
    await wrapper.get('#rippleBy').setValue('2.5');
    expect(wrapper.emitted('update:rippleBy')).toEqual([[2.5]]);
    expect(wrapper.emitted('ripple')).toBeUndefined();
    await wrapper.get('#btnRipple').trigger('click');
    expect(wrapper.emitted('ripple')).toHaveLength(1);
    await wrapper.setProps({ rippleBy: 10 });
    expect(wrapper.get('#rippleBy').element.value).toBe('10');
  });
});
