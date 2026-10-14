import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import TimelineDock from './TimelineDock.vue';
import { DEFAULT, fromJSON } from '../timing.js';

function mountDock(clips = []) {
  const state = fromJSON(DEFAULT);
  return mount(TimelineDock, { props: {
    state, duration: 195, cur: 0, selectedId: state.headlines[0].id, playing: false, offset: 3600, clips,
  } });
}

describe('timeline dock', () => {
  it('includes preview video strips and their legend in the docked timeline', () => {
    const clips = [{ id: 1, name: 'First.mp4', start: 0, dur: 40 },
      { id: 2, name: 'Second.mp4', start: 40, dur: 40 }];
    const dock = mountDock(clips), strips = dock.findAll('.vclip');
    expect(strips.map(strip => strip.attributes('title'))).toEqual(['First.mp4', 'Second.mp4']);
    expect(parseFloat(strips[1].element.style.left)).toBeCloseTo(40 / 195 * 100);
    expect(dock.find('.timeline-legend .video-key').exists()).toBe(true);
    dock.unmount();
  });
  it('renders all chapter bands, selected headline cues and playback time', () => {
    const dock = mountDock();
    expect(dock.findAll('.band')).toHaveLength(6);
    expect(dock.findAll('.tick')).toHaveLength(12);
    expect(dock.findAll('.tick.sel')).toHaveLength(1);
    expect(dock.get('#durChip').text()).toBe('to 3:15');
    expect(dock.get('#timelabel').text()).toBe('0:0001:00:00');
    dock.unmount();
  });
  it('forwards playback and scrub actions without changing document props', async () => {
    const dock = mountDock();
    await dock.get('#btnPlay').trigger('click');
    await dock.get('#scrub').setValue('30');
    expect(dock.emitted('toggle-play')).toHaveLength(1);
    expect(dock.emitted('seek')).toEqual([[30]]);
    expect(dock.props('cur')).toBe(0);
    await dock.setProps({ playing: true, cur: 30 });
    expect(dock.get('#btnPlay').text()).toBe('Pause');
    expect(dock.get('#timelabel').text()).toBe('0:3001:00:30');
    dock.unmount();
  });
  it('forwards pointer seeking from the full timeline', async () => {
    const dock = mountDock(), timeline = dock.get('#tl');
    timeline.element.setPointerCapture = vi.fn();
    vi.spyOn(timeline.element, 'getBoundingClientRect').mockReturnValue({ left: 10, width: 1000 });
    timeline.element.dispatchEvent(new PointerEvent('pointerdown', { clientX: 510, pointerId: 1 }));
    expect(dock.emitted('seek')).toEqual([[97.5]]);
    dock.unmount();
  });
});
