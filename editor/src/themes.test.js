import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Preview from './components/Preview.vue';
import { DEFAULT, fromJSON } from './timing.js';
import { fitWrappedPx, TEXT_SCALE, themeLayout, wrapText } from './themes.js';

let preview;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => {
  preview?.unmount();
  vi.unstubAllGlobals();
});
function mountPreview(theme, count = 12) {
  const state = fromJSON({ ...DEFAULT,
    chapters: Array.from({ length: count }, (_, i) => `Chapter ${i + 1}`),
    chapter_starts: Array.from({ length: count }, (_, i) => [i * 2, i + 1]),
    headlines: [[0, 'A *modern* headline']],
  });
  state.output = { fps: '25/1', theme };
  state.preview_end = count * 2;
  preview = mount(Preview, { props: { state, cur: 0, headlinePx: 70, pillPx: 28, productPx: 30 } });
  return state;
}

describe('video layouts', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 12])('centers the visible Minimal stage pills for %i chapters', count => {
    mountPreview('minimal-stage', count);
    const pills = preview.findAll('.pill').slice(0, 6);
    const left = parseFloat(pills[0].element.style.left);
    const last = pills.at(-1).element.style;
    const right = parseFloat(last.left) + parseFloat(last.width);
    const viewportLeft = parseFloat(preview.get('#chapterViewport').element.style.left);
    expect(viewportLeft + (left + right) / 2).toBe(960);
  });
  it('recenters Minimal stage pills when chapters are added or removed', async () => {
    const state = mountPreview('minimal-stage', 2);
    const firstLeft = () => preview.get('.pill').element.style.left;
    expect(firstLeft()).toBe('602px');
    await preview.setProps({ state: { ...state, chapters: [...state.chapters, 'Chapter 3'],
      chapter_starts: [...state.chapter_starts, { id: 'third', ch: 3, t: 4 }], preview_end: 6 } });
    expect(firstLeft()).toBe('452px');
    expect(preview.get('#chapterProgress').element.parentElement).toBe(preview.get('.pill.on').element);
    await preview.setProps({ state });
    expect(firstLeft()).toBe('602px');
  });
  it('embeds Minimal stage progress in the active pill instead of underneath it', async () => {
    mountPreview('minimal-stage', 2);
    await preview.setProps({ cur: 1 });
    expect(preview.get('#chapterProgress').element.parentElement).toBe(preview.get('.pill.on').element);
    expect(preview.findAll('.pill .chapter-progress')).toHaveLength(1);
    expect(preview.get('#chapterProgress span').element.style.width).toBe('50%');
  });
  it.each(['classic', 'dark-rail', 'minimal-stage', 'cinematic'])('keeps presentation gaps black in %s', async theme => {
    mountPreview(theme);
    await preview.setProps({ cur: 0, presentation: true,
      clips: [{ id: 'c', url: 'blob:clip', start: 5, dur: 5, source_in: 0, source_out: 5 }] });
    expect(preview.get('#content').element.style.background).toBe('rgb(0, 0, 0)');
    expect(preview.find('.gap').exists()).toBe(false);
    expect(preview.get('video').element.style.display).toBe('none');
  });
  it('keeps Minimal stage footage separate from its header and horizontal chapter strip', async () => {
    mountPreview('minimal-stage', 2);
    expect(preview.find('#panel').exists()).toBe(false);
    expect(preview.find('#currentChapter').exists()).toBe(false);
    expect(preview.findAll('.video-fade')).toHaveLength(0);
    const content = preview.get('#content').element.style;
    expect([content.left, content.top, content.width, content.height]).toEqual(['192px', '112px', '1536px', '864px']);
    const pills = preview.findAll('.pill');
    expect(pills.map(pill => pill.element.style.left)).toEqual(['602px', '902px']);
    expect(pills.map(pill => pill.element.style.top)).toEqual(['0px', '0px']);
    expect(preview.get('#chapterViewport').element.style.top).toBe('1008px');
    expect(preview.get('#chapterProgress').element.parentElement).toBe(pills[0].element);
    await preview.setProps({ cur: 1 });
    expect(preview.get('#chapterProgress span').element.style.width).toBe('50%');
    await preview.setProps({ cur: 2 });
    expect(preview.get('#chapterProgress').element.parentElement).toBe(pills[1].element);
    expect(preview.get('#chapterProgress span').element.style.width).toBe('0%');
    expect(preview.get('#chapterCounter').text()).toBe('Chapter 2 of 2');
  });
  it('scrolls the Minimal stage footer horizontally with matching progress and directional hints', async () => {
    mountPreview('minimal-stage');
    expect(preview.find('#chaptersAbove').exists()).toBe(false);
    expect(preview.get('#chaptersBelow').text()).toBe('>');
    await preview.setProps({ cur: 12.4 });
    expect(preview.get('.pill.on').text()).toBe('Chapter 7');
    expect(parseFloat(preview.get('.pill.on').element.style.left)).toBeCloseTo(602);
    expect(preview.get('#chapterProgress').element.parentElement).toBe(preview.get('.pill.on').element);
    expect(preview.get('#chaptersAbove').text()).toBe('<');
    expect(preview.get('#chaptersAbove').attributes('title')).toBe('More chapters to the left');
    await preview.setProps({ cur: 12.2 });
    expect(parseFloat(preview.get('.pill.on').element.style.left)).toBeCloseTo(752);
    expect(preview.get('#chapterProgress').element.parentElement).toBe(preview.get('.pill.on').element);
    await preview.setProps({ cur: 22.4 });
    expect(preview.find('#chaptersBelow').exists()).toBe(false);
    expect(preview.get('.pill.on').element.style.left).toBe('1502px');
    await preview.setProps({ cur: 0 });
    expect(preview.get('.pill.on').element.style.left).toBe('2px');
  });
  it('keeps Minimal stage progress inside its scrolling pill during large chapter jumps', async () => {
    const state = mountPreview('minimal-stage');
    await preview.setProps({ cur: 1.3, state: { ...state,
      chapter_starts: state.chapter_starts.map((chapter, i) => ({ ...chapter, t: i ? 1 : 0 })) } });
    const progress = preview.get('#chapterProgress').element;
    expect(progress.parentElement).toBe(preview.get('.pill.on').element);
    expect(parseFloat(progress.parentElement.style.left)).toBeCloseTo(1783.25);
    expect(progress.parentElement.parentElement.id).toBe('chapterViewport');
    expect(progress.style.height).toBe('4px');
  });
  it('keeps a short Dark rail agenda at the top, with chapter numbering and progress', async () => {
    mountPreview('dark-rail', 2);
    expect(preview.get('.pill').attributes('data-number')).toBe('01');
    expect(preview.get('.pill').element.style.top).toBe('19px');
    expect(preview.get('#chapterCounter').text()).toBe('Chapter 1 of 2');
    expect(preview.get('#chapterProgress span').element.style.width).toBe('0%');
    await preview.setProps({ cur: 1 });
    expect(preview.get('#chapterProgress span').element.style.width).toBe('50%');
    await preview.setProps({ cur: 2 });
    expect(preview.get('.pill.on').text()).toBe('Chapter 2');
    expect(preview.get('#chapterProgress span').element.style.width).toBe('0%');
    await preview.setProps({ cur: 4 });
    expect(preview.get('#chapterProgress span').element.style.width).toBe('100%');
  });
  it('scrolls long Dark rail agendas deterministically and indicates offscreen chapters', async () => {
    mountPreview('dark-rail');
    expect(preview.find('#chaptersAbove').exists()).toBe(false);
    expect(preview.find('#chaptersBelow').exists()).toBe(true);
    await preview.setProps({ cur: 12.4 });
    expect(preview.get('.pill.on').text()).toBe('Chapter 7');
    expect(parseFloat(preview.get('.pill.on').element.style.top)).toBeCloseTo(223);
    expect(preview.find('#chaptersAbove').exists()).toBe(true);
    await preview.setProps({ cur: 22.4 });
    expect(preview.find('#chaptersBelow').exists()).toBe(false);
    await preview.setProps({ cur: 0 });
    expect(preview.get('.pill.on').element.style.top).toBe('19px');
  });
  it('composes Cinematic overlays above full-frame footage and keeps the video element when themes change', async () => {
    const state = mountPreview('cinematic');
    await preview.setProps({ clips: [{ id: 'c', url: 'blob:clip', start: 0, dur: 24, source_in: 0, source_out: 24 }] });
    const video = preview.get('video').element;
    expect(preview.get('#content').element.style.width).toBe('1920px');
    expect(preview.get('#content').element.style.height).toBe('1080px');
    expect(preview.findAll('.video-fade')).toHaveLength(2);
    expect(preview.find('#panel').exists()).toBe(false);
    expect(preview.get('#currentChapter').text()).toContain('01 / 12');
    expect(preview.get('#logo').attributes('src')).not.toMatch(/^https:/);
    await preview.setProps({ cur: 13 });
    expect(preview.get('#currentChapter').text()).toContain('Chapter 7');
    expect(preview.get('#chapterProgress span').element.style.width).toBe('50%');
    await preview.setProps({ state: { ...state, output: { ...state.output, theme: 'dark-rail' } } });
    expect(preview.get('video').element).toBe(video);
    expect(preview.findAll('.video-fade')).toHaveLength(0);
    expect(preview.get('#content').element.style.width).toBe('1504px');
  });
  it.each(['dark-rail', 'minimal-stage'])('fits wrapped %s titles into at most two lines without clipping long words', theme => {
    const d = themeLayout(theme), titles = ['SUSE Rancher Prime', 'A long chapter title with several words', 'UnbreakablyLongChapterTitle'],
      measure = (text, px) => text.length * px / 2;
    const px = fitWrappedPx(titles, d.PILL_TEXT_PX * TEXT_SCALE, d.PILL_TEXT_MAX_W, d.PILL_LINES, measure);
    expect(px).toBeGreaterThan(0);
    for (const title of titles) {
      const lines = wrapText(title, d.PILL_TEXT_MAX_W, text => measure(text, px));
      expect(lines.length).toBeLessThanOrEqual(2);
      expect(Math.max(...lines.map(text => measure(text, px)))).toBeLessThanOrEqual(d.PILL_TEXT_MAX_W);
    }
  });
});
