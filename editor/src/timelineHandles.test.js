import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';

vi.mock('./fileAccess.js', () => ({
  downloadJSON: vi.fn(), rememberHandle: vi.fn().mockResolvedValue(),
  rememberedHandle: vi.fn().mockResolvedValue(null), pickerOptions: {},
}));

describe('retiming headlines on the timeline, and chapter clicks', () => {
  let wrapper;
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: t => ({ width: t.length * 14 }) });
    Element.prototype.scrollIntoView = vi.fn();
    wrapper = mount(App, { attachTo: document.body });
  });
  afterEach(() => { wrapper.unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const handles = () => wrapper.findAll('#tl .headline-handle');
  const press = (handle, key, shiftKey = false) => handle.trigger('keydown', { key, shiftKey });

  it('moves where a headline starts, and where the previous one ends', async () => {
    const second = handles()[1];                                  // the sample's second headline starts at 15 s
    expect(second.attributes('aria-valuenow')).toBe('15');
    await press(second, 'ArrowRight');
    expect(handles()[1].attributes('aria-valuenow')).toBe('15.1');
    expect(wrapper.findAll('#tl .headline-band')[0].attributes('title')).toContain('0:00 – 0:15.1');
    expect(wrapper.get('#scrub').element.value).toBe('15.1');   // the preview follows the handle
    expect(wrapper.get('#status').text()).toContain('unsaved');
    await press(handles()[1], 'ArrowLeft', true);
    expect(handles()[1].attributes('aria-valuenow')).toBe('14.1');
  });
  it('keeps a headline between its neighbours and inside its chapter', async () => {
    for (let i = 0; i < 40; i++) await press(handles()[1], 'ArrowRight', true);
    expect(handles()[1].attributes('aria-valuenow')).toBe('29.9');      // chapter 2 starts at 30 s
    for (let i = 0; i < 40; i++) await press(handles()[1], 'ArrowLeft', true);
    expect(handles()[1].attributes('aria-valuenow')).toBe('0.1');       // the first headline starts at 0 s
  });
  it('can be undone', async () => {
    await press(handles()[1], 'ArrowRight', true);
    expect(handles()[1].attributes('aria-valuenow')).toBe('16');
    await wrapper.get('#btnUndo').trigger('click');
    expect(handles()[1].attributes('aria-valuenow')).toBe('15');
  });
  it('drags with the pointer', async () => {
    const tl = wrapper.get('#tl').element;
    tl.getBoundingClientRect = () => ({ left: 0, width: 1000 });
    const handle = handles()[1];
    handle.element.setPointerCapture = vi.fn();
    const total = Number(wrapper.get('#scrub').attributes('max'));
    await handle.trigger('pointerdown');
    handle.element.dispatchEvent(new MouseEvent('pointermove', { clientX: 1000 * 20 / total, bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(handles()[1].attributes('aria-valuenow')).toBe('20');
  });
  it('moves the playhead and timeline when a chapter is clicked in the list', async () => {
    await wrapper.findAll('#chapters .crow')[2].trigger('click');
    expect(wrapper.get('#scrub').element.value).toBe('60.1');           // chapter 3 starts at 60 s
    expect(wrapper.get('.chapter-inspector h3').text()).toBe('SUSE Virtualization');
  });
});
