import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EditorWorkspace from './EditorWorkspace.vue';

let wrapper, resizeObserver;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) {
      this.callback = callback;
      this.disconnect = vi.fn();
      resizeObserver = this;
    }
    observe() { this.callback([{ contentRect: { width: 1000 } }]); }
  });
  wrapper = mount(EditorWorkspace, { attachTo: document.body, slots: {
    editor: '<aside id="editor-panel" class="editor-panel">Editor</aside>',
    preview: '<section class="preview-pane">Preview</section>',
  } });
  wrapper.get('.resize-handle').element.setPointerCapture = vi.fn();
});
afterEach(() => {
  wrapper.unmount();
  expect(resizeObserver.disconnect).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});
function pointer(type, clientX, pointerId = 1, button = 0) {
  wrapper.get('.resize-handle').element.dispatchEvent(new PointerEvent(type, { clientX, pointerId, button }));
}
const width = () => wrapper.element.style.getPropertyValue('--sidebar-width');

describe('resizable editor workspace', () => {
  it('offers an accessible separator between editor and preview', async () => {
    await nextTick();
    const separator = wrapper.get('[role="separator"]');
    expect(separator.attributes('aria-orientation')).toBe('vertical');
    expect(separator.attributes('aria-controls')).toBe('editor-panel');
    expect(separator.attributes('aria-valuenow')).toBe('30');
    expect(separator.attributes('aria-valuemin')).toBe('30');
    expect(separator.attributes('aria-valuemax')).toBe('60');
    expect(separator.element.previousElementSibling.id).toBe('editor-panel');
    expect(separator.element.nextElementSibling.className).toBe('preview-pane');
  });
  it('drags using pointer capture and clamps width to keep both panels usable', async () => {
    pointer('pointerdown', 300);
    expect(wrapper.get('.resize-handle').element.setPointerCapture).toHaveBeenCalledWith(1);
    pointer('pointermove', 450);
    await nextTick();
    expect(width()).toBe('45%');
    expect(wrapper.classes()).toContain('resizing');
    pointer('pointermove', 2000);
    await nextTick();
    expect(width()).toBe('60%');
    pointer('pointermove', -2000);
    await nextTick();
    expect(width()).toBe('30%');
    pointer('pointerup', -2000);
    pointer('pointermove', 500);
    await nextTick();
    expect(wrapper.classes()).not.toContain('resizing');
    expect(width()).toBe('30%');
  });
  it('ignores secondary buttons and unrelated pointers, and ends a cancelled drag', async () => {
    pointer('pointerdown', 300, 1, 2);
    pointer('pointermove', 500);
    await nextTick();
    expect(width()).toBe('30%');
    pointer('pointerdown', 300);
    pointer('pointerdown', 400, 2);
    pointer('pointermove', 500, 2);
    pointer('pointerup', 500, 2);
    await nextTick();
    expect(width()).toBe('30%');
    expect(wrapper.classes()).toContain('resizing');
    pointer('pointermove', 400);
    pointer('pointercancel', 400);
    pointer('pointermove', 500);
    await nextTick();
    expect(width()).toBe('40%');
    expect(wrapper.classes()).not.toContain('resizing');
  });
  it('stops resizing when pointer capture is lost', async () => {
    pointer('pointerdown', 300);
    pointer('pointermove', 400);
    pointer('lostpointercapture', 400);
    pointer('pointermove', 500);
    await nextTick();
    expect(width()).toBe('40%');
    expect(wrapper.classes()).not.toContain('resizing');
  });
  it('supports fine and coarse keyboard resizing, limits, and resetting', async () => {
    const separator = wrapper.get('.resize-handle');
    await separator.trigger('keydown', { key: 'ArrowRight' });
    expect(width()).toBe('31%');
    await separator.trigger('keydown', { key: 'ArrowRight', shiftKey: true });
    expect(width()).toBe('36%');
    await separator.trigger('keydown', { key: 'ArrowLeft' });
    expect(width()).toBe('35%');
    await separator.trigger('keydown', { key: 'End' });
    expect(width()).toBe('60%');
    await separator.trigger('keydown', { key: 'ArrowRight' });
    expect(width()).toBe('60%');
    await separator.trigger('keydown', { key: 'Home' });
    expect(width()).toBe('30%');
    await separator.trigger('keydown', { key: 'ArrowLeft' });
    expect(width()).toBe('30%');
    await separator.trigger('keydown', { key: 'End' });
    await separator.trigger('keydown', { key: 'Enter' });
    expect(width()).toBe('30%');
    await separator.trigger('keydown', { key: 'End' });
    await separator.trigger('dblclick');
    expect(width()).toBe('30%');
  });
  it('recalculates bounds as the viewport changes and cleans up observation', async () => {
    resizeObserver.callback([{ contentRect: { width: 1500 } }]);
    await wrapper.get('.resize-handle').trigger('keydown', { key: 'Home' });
    expect(width()).toBe('20%');
    expect(wrapper.get('.resize-handle').attributes('aria-valuenow')).toBe('20');
    resizeObserver.callback([{ contentRect: { width: 1000 } }]);
    await nextTick();
    expect(wrapper.get('.resize-handle').attributes('aria-valuenow')).toBe('30');
    resizeObserver.callback([{ contentRect: { width: 400 } }]);
    await nextTick();
    expect(wrapper.get('.resize-handle').attributes('aria-valuemin')).toBe('60');
  });
});
