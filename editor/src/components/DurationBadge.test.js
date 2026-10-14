import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import DurationBadge from './DurationBadge.vue';

describe('duration badge', () => {
  it.each([
    [0, 'Length 0:00'],
    [15, 'Length 0:15'],
    [90, 'Length 1:30'],
    [1.5, 'Length 0:01.5'],
  ])('formats a duration of %s seconds as %s', (duration, text) => {
    const badge = mount(DurationBadge, { props: { duration } });
    expect(badge.text()).toBe(text);
    expect(badge.classes()).not.toContain('warn');
    badge.unmount();
  });
  it('preserves context-specific titles, warning styling and layout classes', async () => {
    const badge = mount(DurationBadge, {
      props: { duration: 2, warning: true, title: 'Time on screen.' }, attrs: { class: 'chapter-duration' },
    });
    expect(badge.attributes('title')).toBe('Time on screen.');
    expect(badge.classes()).toContain('warn');
    expect(badge.classes()).toContain('chapter-duration');
    await badge.setProps({ warning: false, duration: 10 });
    expect(badge.text()).toBe('Length 0:10');
    expect(badge.classes()).not.toContain('warn');
    badge.unmount();
  });
  it('explicitly warns for a segment past its end instead of formatting it as zero', () => {
    const badge = mount(DurationBadge, { props: { duration: -5 } });
    expect(badge.text()).toBe('Past end');
    expect(badge.classes()).toContain('warn');
    expect(badge.attributes('title')).toBe('This segment starts after its end.');
    badge.unmount();
  });
});
