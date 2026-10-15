import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PreviewPlayer from './PreviewPlayer.vue';
import Preview from './Preview.vue';
import { DEFAULT, fromJSON } from '../timing.js';

let wrapper, fullscreenElement, requestFullscreen, exitFullscreen;
beforeEach(() => {
  fullscreenElement = null;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  requestFullscreen = vi.fn(async function () {
    fullscreenElement = this;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  exitFullscreen = vi.fn(async () => {
    fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, writable: true, value: requestFullscreen });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen });
  wrapper = mount(PreviewPlayer, { attachTo: document.body, props: {
    state: fromJSON(DEFAULT), cur: 0, headlinePx: 70, pillPx: 28, productPx: 56,
    clips: [{ id: 'clip', name: 'demo.mp4', url: 'blob:demo', start: 0, dur: 10, source_in: 2, source_out: 12 }],
  } });
});
afterEach(() => {
  wrapper.unmount();
  delete Element.prototype.requestFullscreen;
  delete document.exitFullscreen;
  delete document.fullscreenElement;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fullscreen preview player', () => {
  it('fullscreens the entire composition, starts muted, and stops presentation on browser exit', async () => {
    await wrapper.vm.enterFullscreen();
    await flushPromises();
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(fullscreenElement).toBe(wrapper.get('.preview-canvas').element);
    expect(wrapper.emitted('present')).toEqual([[true]]);
    expect(wrapper.findComponent(Preview).props()).toMatchObject({ presentation: true, muted: true });
    expect(wrapper.get('video').element.muted).toBe(true);
    expect(document.activeElement).toBe(fullscreenElement);
    fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    await flushPromises();
    expect(wrapper.emitted('present')).toEqual([[true], [false]]);
    expect(wrapper.find('.presentation-controls').exists()).toBe(false);
    expect(wrapper.findComponent(Preview).props('muted')).toBe(false);
  });
  it('provides audio, playback and exit controls and resets mute on each presentation', async () => {
    await wrapper.vm.enterFullscreen();
    await flushPromises();
    await wrapper.get('.presentation-controls [aria-pressed]').trigger('click');
    expect(wrapper.get('video').element.muted).toBe(false);
    expect(wrapper.get('.presentation-controls [aria-pressed]').text()).toBe('Mute audio');
    await wrapper.get('[aria-label="Pause or resume fullscreen playback"]').trigger('click');
    expect(wrapper.emitted('toggle-play')).toHaveLength(1);
    await wrapper.findAll('.presentation-controls button')[2].trigger('click');
    expect(exitFullscreen).toHaveBeenCalledOnce();
    await wrapper.vm.enterFullscreen();
    await flushPromises();
    expect(wrapper.get('video').element.muted).toBe(true);
  });
  it('hides controls during playback and reveals them for pointer or keyboard activity', async () => {
    vi.useFakeTimers();
    await wrapper.vm.enterFullscreen();
    await wrapper.setProps({ playing: true });
    await vi.advanceTimersByTimeAsync(3100);
    expect(wrapper.get('.preview-canvas').classes()).toContain('controls-hidden');
    await wrapper.get('.preview-canvas').trigger('pointermove');
    expect(wrapper.get('.preview-canvas').classes()).not.toContain('controls-hidden');
    await vi.advanceTimersByTimeAsync(3100);
    await wrapper.get('.preview-canvas').trigger('keydown', { key: 'Tab' });
    expect(wrapper.get('.preview-canvas').classes()).not.toContain('controls-hidden');
    await vi.advanceTimersByTimeAsync(3100);
    await wrapper.setProps({ playing: false });
    expect(wrapper.get('.preview-canvas').classes()).not.toContain('controls-hidden');
  });
  it('rejects empty or partially relinked projects with an actionable message', async () => {
    await wrapper.setProps({ clips: [] });
    await wrapper.vm.enterFullscreen();
    expect(wrapper.get('[role=alert]').text()).toContain('Add videos');
    await wrapper.setProps({ clips: [{ id: 'missing', start: 0, dur: 10 }] });
    await wrapper.vm.enterFullscreen();
    expect(wrapper.get('[role=alert]').text()).toContain('Relink all missing videos');
    expect(requestFullscreen).not.toHaveBeenCalled();
  });
  it('reports unsupported and denied fullscreen without starting playback', async () => {
    delete Element.prototype.requestFullscreen;
    await wrapper.vm.enterFullscreen();
    expect(wrapper.get('[role=alert]').text()).toContain('Fullscreen is not supported');
    Element.prototype.requestFullscreen = vi.fn().mockRejectedValue(new Error('Permission denied'));
    await wrapper.vm.enterFullscreen();
    await flushPromises();
    expect(wrapper.get('[role=alert]').text()).toContain('Permission denied');
    expect(wrapper.emitted('present')).toBeUndefined();
  });
  it('shows playback errors in fullscreen and forwards them to stop the clock', async () => {
    await wrapper.vm.enterFullscreen();
    const error = new Error('Could not play demo.mp4');
    wrapper.findComponent(Preview).vm.$emit('playback-error', error);
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[role=alert]').text()).toBe(error.message);
    expect(wrapper.emitted('playback-error')).toEqual([[error]]);
  });
});
