import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Player from './Player.vue';
import PlayerTimeline from './PlayerTimeline.vue';
import { boothState } from './data.js';
import { fromJSON } from '../timing.js';

const timing = { schema_version: 2, title: 'Booth demo', product_name: 'SUSE AI Factory',
  chapters: [
    { title: 'Overview', start: 0, headlines: [[0, 'Welcome to *Overview*']] },
    { title: 'Blueprints', start: 15, headlines: [[0, 'Blueprints *intro*']] },
    { title: 'Install', start: 30, level: 1, headlines: [[0, 'Install it']] },
    { title: 'Create', start: 45, level: 1, headlines: [[0, 'Create it']] },
    { title: 'Traces', start: 60, headlines: [[0, 'Follow *traces*']] },
  ] };
const data = (extra = {}) => JSON.stringify({ title: 'Booth demo', output: { theme: 'dark-rail' }, timing, video: 'video.mp4', ...extra });

describe('page data', () => {
  it('reads the project the export embedded', () => {
    const { state, video, title } = boothState(data());
    expect(video).toBe('video.mp4');
    expect(title).toBe('Booth demo');
    expect(state.output.theme).toBe('dark-rail');
    expect(state.chapters).toEqual(['Overview', 'Blueprints', 'Install', 'Create', 'Traces']);
    expect(state.chapter_starts.map(c => c.level)).toEqual([0, 0, 1, 1, 0]);
  });
  it('falls back to the sample layout, without a video, when nothing was embedded', () => {
    for (const text of ['__BOOTH_DATA__', '', '{}', 'null']) {
      const { state, video } = boothState(text);
      expect(video).toBe('');
      expect(state.chapters.length).toBeGreaterThan(1);
    }
  });
  it('refuses a theme it does not know', () => {
    expect(() => boothState(data({ output: { theme: 'nope' } }))).toThrow('Unknown video theme');
  });
});

describe('the interactive page', () => {
  let wrapper, probes;
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: t => ({ width: t.length * 14 }) });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    probes = [];
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(tag => {
      const el = create(tag);
      if (tag === 'video' && !probes.length) probes.push(el);       // the first one is the page's own length probe
      return el;
    });
  });
  afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  async function open(video = 'video.mp4', length = 90) {
    const { state } = boothState(data());
    wrapper = mount(Player, { attachTo: document.body, props: { state, video, title: 'Booth demo' } });
    if (length) {
      Object.defineProperty(probes[0], 'duration', { value: length });
      probes[0].onloadedmetadata();
    }
    await flushPromises();
    return wrapper;
  }
  const names = () => wrapper.findAll('.pill').map(p => p.text());
  const key = (k, init = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));

  it('shows the layout over the video, with sub-chapters collapsed', async () => {
    await open();
    expect(wrapper.findAll('#content video')).toHaveLength(1);
    expect(wrapper.get('#content video').attributes('src')).toBe('video.mp4');
    expect(names()).toEqual(['Overview', 'Blueprints', 'Traces']);
    expect(wrapper.get('.player-time').text()).toBe('0:00 / 1:30');
    expect(wrapper.get('#chapterCounter').text()).toBe('Chapter 1 of 3');
  });
  it('shows the whole headline while paused, so the first screen is not empty', async () => {
    await open();
    expect(wrapper.get('#hl').element.style.clipPath).toContain('0%');
    expect(wrapper.get('#hl').text()).toBe('Welcome to Overview');
  });
  it('pressing a chapter jumps to it and plays', async () => {
    await open();
    await wrapper.findAll('.pill')[1].trigger('click');
    expect(wrapper.vm.cur).toBe(15);
    expect(wrapper.vm.playing).toBe(true);
    expect(names()).toEqual(['Overview', 'Blueprints', 'Install', 'Create', 'Traces']);     // it opened
    expect(wrapper.get('.pill.on').text()).toBe('Blueprints');
  });
  it('chapter buttons can be pressed from the keyboard and say what they do', async () => {
    await open();
    const button = wrapper.findAll('.pill')[2];
    expect(button.attributes('role')).toBe('button');
    expect(button.attributes('tabindex')).toBe('0');
    expect(button.attributes('aria-label')).toBe('Go to Traces');
    await button.trigger('keydown', { key: 'Enter' });
    expect(wrapper.vm.cur).toBe(60);
  });
  it('clicking or dragging the timeline jumps there', async () => {
    await open();
    const timeline = wrapper.getComponent(PlayerTimeline);
    timeline.vm.$emit('scrub', 20);
    expect(wrapper.vm.cur).toBe(20);
    expect(wrapper.vm.playing).toBe(false);                          // paused while dragging
    timeline.vm.$emit('commit', 50);
    expect(wrapper.vm.cur).toBe(50);
    expect(wrapper.vm.playing).toBe(true);
  });
  it('keys: space plays and pauses, arrows skip, N and P step through the chapters', async () => {
    await open();
    key(' ');
    expect(wrapper.vm.playing).toBe(true);
    key(' ');
    expect(wrapper.vm.playing).toBe(false);
    key('ArrowRight');
    expect(wrapper.vm.cur).toBe(5);
    key('ArrowRight', { shiftKey: true });
    expect(wrapper.vm.cur).toBe(20);
    key('ArrowLeft');
    expect(wrapper.vm.cur).toBe(15);
    key('n');                                                        // from 15: the next start is Install at 30
    expect(wrapper.vm.cur).toBe(30);
    key('p');                                                        // 30 is the start of Install: back to Blueprints
    expect(wrapper.vm.cur).toBe(15);
    key('Home');
    expect(wrapper.vm.cur).toBe(0);
  });
  it('previous chapter first restarts the chapter that is playing', async () => {
    await open();
    wrapper.vm.seek(40);
    wrapper.vm.nextChapter(-1);
    expect(wrapper.vm.cur).toBe(30);
  });
  it('plays again from the start when it is at the end', async () => {
    await open();
    key('End');
    expect(wrapper.vm.cur).toBeGreaterThan(89);
    key(' ');
    expect(wrapper.vm.cur).toBe(0);
    expect(wrapper.vm.playing).toBe(true);
  });
  it('says so when the video cannot be loaded', async () => {
    await open('video.mp4', 0);
    probes[0].onerror();
    await flushPromises();
    expect(wrapper.get('.player-note').text()).toContain('Could not load video.mp4');
    expect(wrapper.get('.player-play').attributes('disabled')).toBeDefined();
  });
  it('is only a sample layout when no video was exported', async () => {
    const { state } = boothState('');
    wrapper = mount(Player, { attachTo: document.body, props: { state, video: '' } });
    expect(wrapper.get('.player-note').text()).toContain('No video');
    expect(wrapper.find('.player-surface').exists()).toBe(false);
  });
});

describe('page timeline', () => {
  const state = { ...fromJSON(timing), output: { theme: 'dark-rail' }, preview_end: 90 };
  const pointer = (wrapper, type, clientX) => wrapper.get('.ptl').element.dispatchEvent(new MouseEvent(type, { clientX, button: 0, bubbles: true }));
  const mountTimeline = (nested = true) => mount(PlayerTimeline, { props: { state, total: 90, cur: 12, nested } });

  it('has a segment for every chapter, sized by its length, and marks headlines', () => {
    const wrapper = mountTimeline();
    const segments = wrapper.findAll('.ptl-seg');
    expect(segments.map(s => s.find('.ptl-label').text())).toEqual(['Overview', 'Blueprints', 'Install', 'Create', 'Traces']);
    expect(segments[0].element.style.width).toBe('16.666666666666664%');
    expect(wrapper.findAll('.ptl-seg.sub')).toHaveLength(2);
    expect(wrapper.findAll('.ptl-ticks i')).toHaveLength(5);
    expect(wrapper.get('.ptl-head').element.style.left).toBe('13.333333333333334%');
  });
  it('shades sub-chapters only in themes that list them', () => {
    expect(mountTimeline(false).findAll('.ptl-seg.sub')).toHaveLength(0);
  });
  it('is a slider that reports the time', () => {
    const slider = mountTimeline().get('[role=slider]');
    expect(slider.attributes('aria-valuenow')).toBe('12');
    expect(slider.attributes('aria-valuemax')).toBe('90');
    expect(slider.attributes('aria-valuetext')).toBe('0:12 of 1:30, Overview');
  });
  it('names the chapter and headline under the pointer', async () => {
    const wrapper = mountTimeline();
    const track = wrapper.get('.ptl').element;
    track.getBoundingClientRect = () => ({ left: 100, width: 900, top: 0, height: 56 });
    pointer(wrapper, 'pointermove', 100 + 900 * (35 / 90));
    await wrapper.vm.$nextTick();
    expect(wrapper.get('.ptl-tip').text()).toBe('0:35 · 2.1 Install — Install it');
  });
  it('scrubs while the pointer is down and commits when it is released', async () => {
    const wrapper = mountTimeline();
    wrapper.get('.ptl').element.getBoundingClientRect = () => ({ left: 0, width: 900, top: 0, height: 56 });
    wrapper.get('.ptl').element.setPointerCapture = vi.fn();
    pointer(wrapper, 'pointerdown', 90);
    pointer(wrapper, 'pointermove', 450);
    pointer(wrapper, 'pointerup', 900);
    expect(wrapper.emitted('scrub').map(e => Math.round(e[0]))).toEqual([9, 45]);
    expect(wrapper.emitted('commit').map(e => Math.round(e[0]))).toEqual([90]);
  });
});
