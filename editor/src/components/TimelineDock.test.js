import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import TimelineDock from './TimelineDock.vue';
import { DEFAULT, fromJSON } from '../timing.js';

function mountDock(clips = []) {
  const state = { ...fromJSON(DEFAULT), output: { fps: '25/1' } };
  clips = clips.map(clip => ({ source_in: 0, source_out: clip.dur, sourceDuration: clip.dur, ...clip }));
  return mount(TimelineDock, { props: {
    state, duration: 195, cur: 0, selectedId: state.headlines[0].id, playing: false, offset: 3600, clips,
  } });
}

describe('timeline dock', () => {
  it('includes preview video strips and their legend in the docked timeline', () => {
    const clips = [{ id: 1, name: 'First.mp4', start: 0, dur: 40 },
      { id: 2, name: 'Second.mp4', start: 40, dur: 40 }];
    const dock = mountDock(clips), strips = dock.findAll('.vclip');
    expect(strips.map(strip => strip.attributes('title'))).toEqual(['First.mp4  0:00 – 0:40', 'Second.mp4  0:40 – 1:20']);
    expect(strips[0].text()).toContain('First.mp4');
    expect(strips[0].text()).toContain('0:40');
    expect(parseFloat(strips[1].element.style.left)).toBeCloseTo(40 / 195 * 100);
    expect(dock.find('.timeline-legend .video-key').exists()).toBe(true);
    dock.unmount();
  });
  it('shows the videos row above the chapters and lets you toggle it off and on, remembering the choice', async () => {
    localStorage.removeItem('timeline_show_videos');
    const clips = [{ id: 1, name: 'First.mp4', start: 0, dur: 40 }];
    const dock = mountDock(clips);
    const toggle = dock.get('#toggleVideos');
    expect(toggle.attributes('aria-pressed')).toBe('true');
    expect(dock.findAll('.vclip')).toHaveLength(1);
    expect(dock.get('#tl').element.style.getPropertyValue('--vt')).toBe('26px');   // everything below shifts down
    await toggle.trigger('click');
    expect(toggle.attributes('aria-pressed')).toBe('false');
    expect(dock.findAll('.vclip')).toHaveLength(0);
    expect(dock.get('#tl').element.style.getPropertyValue('--vt')).toBe('0px');
    expect(localStorage.getItem('timeline_show_videos')).toBe('0');
    dock.unmount();
    const again = mountDock(clips);                                                // a later visit starts hidden
    expect(again.get('#toggleVideos').attributes('aria-pressed')).toBe('false');
    await again.get('#toggleVideos').trigger('click');
    expect(again.findAll('.vclip')).toHaveLength(1);
    expect(localStorage.getItem('timeline_show_videos')).toBe('1');
    again.unmount();
    localStorage.removeItem('timeline_show_videos');
  });
  it('disables the videos toggle and adds no row when no video is loaded', () => {
    const dock = mountDock();
    expect(dock.get('#toggleVideos').attributes('disabled')).toBeDefined();
    expect(dock.get('#toggleVideos').attributes('aria-pressed')).toBe('false');
    expect(dock.get('#tl').element.style.getPropertyValue('--vt')).toBe('0px');
    dock.unmount();
  });
  it('adds accessible trim handles and forwards source-aware keyboard edits without seeking', async () => {
    const dock = mountDock([
      { id: 1, name: 'Before.mp4', start: 0, dur: 8 },
      { id: 2, name: 'Trimmed.mp4', start: 10, dur: 10, source_in: 5, source_out: 15, sourceDuration: 50 },
      { id: 3, name: 'After.mp4', start: 25, dur: 10 },
    ]);
    const start = dock.get('[aria-label="Trim video start: Trimmed.mp4"]');
    const end = dock.get('[aria-label="Trim video end: Trimmed.mp4"]');
    expect(dock.findAll('.clip-handle')).toHaveLength(6);
    expect(start.attributes('role')).toBe('slider');
    expect(start.attributes('aria-valuemin')).toBe('8');
    expect(start.attributes('aria-valuemax')).toBe('19.9');
    expect(end.attributes('aria-valuemax')).toBe('25');
    await start.trigger('keydown', { key: 'ArrowLeft', shiftKey: true });
    await end.trigger('keydown', { key: 'ArrowRight' });
    expect(dock.emitted('trim-clip')[0]).toEqual([expect.objectContaining({ id: 2 }), { start: 9, source_in: 4 }, 9]);
    expect(dock.emitted('trim-clip')[1][1].source_out).toBeCloseTo(15.1);
    expect(dock.emitted('begin-edit')).toHaveLength(2);
    expect(dock.emitted('seek')).toBeUndefined();
    await dock.get('#toggleVideos').trigger('click');
    expect(dock.findAll('.clip-handle')).toHaveLength(0);
    await dock.get('#toggleVideos').trigger('click');
    dock.unmount();
    localStorage.removeItem('timeline_show_videos');
  });
  it('limits trims to source bounds and keeps at least one frame for low output rates', async () => {
    const dock = mountDock([{ id: 1, name: 'Short.mp4', start: 2, dur: 2, source_in: 0.5, source_out: 2.5, sourceDuration: 3 }]);
    await dock.setProps({ state: { ...dock.props('state'), output: { fps: '1/1' } } });
    const start = dock.get('.clip-handle.start'), end = dock.get('.clip-handle.end');
    expect(start.attributes('aria-valuemin')).toBe('1.5');
    expect(start.attributes('aria-valuemax')).toBe('3');
    expect(end.attributes('aria-valuemin')).toBe('3');
    expect(end.attributes('aria-valuemax')).toBe('4.5');
    await start.trigger('keydown', { key: 'ArrowLeft', shiftKey: true });
    await end.trigger('keydown', { key: 'ArrowRight', shiftKey: true });
    expect(dock.emitted('trim-clip')[0][1]).toEqual({ start: 1.5, source_in: 0 });
    expect(dock.emitted('trim-clip')[1][1]).toEqual({ source_out: 3 });
    dock.unmount();
  });
  it('allows shortening missing media but not extending it past its known source out', async () => {
    const dock = mountDock([{ id: 1, name: 'Missing.mp4', start: 2, dur: 10, source_in: 3, source_out: 13, sourceDuration: undefined }]);
    const end = dock.get('.clip-handle.end');
    expect(end.attributes('aria-valuemax')).toBe('12');
    await end.trigger('keydown', { key: 'ArrowRight', shiftKey: true });
    expect(dock.emitted('trim-clip')[0][1]).toEqual({ source_out: 13 });
    await end.trigger('keydown', { key: 'ArrowLeft', shiftKey: true });
    expect(dock.emitted('trim-clip')[1][1]).toEqual({ source_out: 12 });
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
  it('zooms the timeline in steps and back to fit, without changing the document or seeking', async () => {
    const dock = mountDock();
    expect(dock.get('#zoomLabel').text()).toBe('Fit');
    expect(dock.get('#zoomOut').attributes('disabled')).toBeDefined();
    await dock.get('#zoomIn').trigger('click');
    expect(dock.get('#tl').element.style.width).toBe('200%');
    expect(dock.get('#zoomLabel').text()).toBe('×2');
    await dock.get('#zoomIn').trigger('click');
    expect(dock.get('#tl').element.style.width).toBe('400%');
    await dock.get('#zoomOut').trigger('click');
    expect(dock.get('#zoomLabel').text()).toBe('×2');
    await dock.get('#zoomFit').trigger('click');
    expect(dock.get('#tl').element.style.width).toBe('100%');
    for (let i = 0; i < 10; i++) await dock.get('#zoomIn').trigger('click');
    expect(dock.get('#zoomLabel').text()).toBe('×16');               // 195 s: stops at about 10 s across
    expect(dock.get('#zoomIn').attributes('disabled')).toBeDefined();
    expect(dock.emitted('seek')).toBeUndefined();
    dock.unmount();
  });
  it('zooms with Ctrl/Cmd + scroll and adds finer ruler ticks when zoomed', async () => {
    const dock = mountDock();
    const labels = () => dock.findAll('.ruler span').map(s => s.text());
    expect(labels()).toContain('0:30');
    expect(labels()).not.toContain('0:02');
    const wheel = async init => {
      dock.get('.tl-scroll').element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init }));
      await dock.vm.$nextTick();
    };
    await wheel({ deltaY: -100, ctrlKey: true });
    expect(dock.get('#zoomLabel').text()).toBe('×2');
    await wheel({ deltaY: 100, metaKey: true });
    expect(dock.get('#zoomLabel').text()).toBe('Fit');
    await wheel({ deltaY: -100 });               // a plain scroll does not zoom
    expect(dock.get('#zoomLabel').text()).toBe('Fit');
    for (let i = 0; i < 4; i++) await dock.get('#zoomIn').trigger('click');
    expect(labels()).toContain('0:02');
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
