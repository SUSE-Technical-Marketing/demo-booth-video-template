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
    expect(dock.findAll('.headline-band')).toHaveLength(12);
    expect(dock.findAll('.headline-band.sel')).toHaveLength(1);
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
  it('clips headline bands at chapter and video ends and keeps invalid cues as markers', () => {
    const state = fromJSON({ schema_version: 2, chapters: [
      { title: 'First', start: 0, headlines: [[2, 'First headline'], [8, 'Last headline'], [12, 'Outside']] },
      { title: 'Empty', start: 10, headlines: [] },
      { title: 'Later', start: 20, headlines: [[3, 'Delayed']] },
    ] });
    const bounded = mount(TimelineDock, { props: {
      state, duration: 30, cur: 0, offset: 3600, playing: false, selectedChapterId: state.chapter_starts[0].id,
    } });
    const bands = bounded.findAll('.headline-band');
    expect(parseFloat(bands[0].element.style.left)).toBeCloseTo(2 / 30 * 100);
    expect(parseFloat(bands[0].element.style.width)).toBeCloseTo(6 / 30 * 100);
    expect(parseFloat(bands[1].element.style.width)).toBeCloseTo(2 / 30 * 100);
    expect(bands[2].classes()).toContain('marker');
    expect(bands[2].classes()).toContain('outside');
    expect(bands[2].element.style.width).toBe('0%');
    expect(parseFloat(bands[3].element.style.width)).toBeCloseTo(7 / 30 * 100);
    expect(bands[0].classes()).toContain('owner');
    bounded.unmount();
  });
  it('forwards keyboard band selection and starts seeking at its actual absolute time', async () => {
    const dock = mountDock();
    await dock.findAll('.band')[1].trigger('click');
    expect(dock.emitted('select-chapter')[0][0].t).toBe(30);
    await dock.findAll('.headline-band')[3].trigger('click');
    expect(dock.emitted('select-headline')[0][0].t).toBe(15);
    expect(dock.emitted('seek')).toEqual([[30], [45]]);
    dock.unmount();
  });
  it('selects a pointer-hit headline while scrubbing within its band', () => {
    const dock = mountDock(), timeline = dock.get('#tl');
    timeline.element.setPointerCapture = vi.fn();
    vi.spyOn(timeline.element, 'getBoundingClientRect').mockReturnValue({ left: 10, width: 1000 });
    dock.findAll('.headline-band')[1].element.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 110, pointerId: 1, bubbles: true,
    }));
    expect(dock.emitted('select-headline')[0][0].text).toBe(DEFAULT.headlines[1][1]);
    expect(dock.emitted('seek')).toEqual([[19.5]]);
    dock.unmount();
  });
});
