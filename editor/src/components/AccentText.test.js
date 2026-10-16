import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AccentText from './AccentText.vue';
import { plain } from '../timing.js';

const render = text => mount({
  components: { AccentText }, props: { text: String }, template: '<div><AccentText :text="text" /></div>',
}, { props: { text } });

describe('headline emphasis boundaries', () => {
  it.each([
    ['*bold*characters after', 'boldcharacters after', ['bold']],
    ['*Kubernetes*, anywhere', 'Kubernetes, anywhere', ['Kubernetes']],
    ['*AI*-powered *GPU*!', 'AI-powered GPU!', ['AI', 'GPU']],
    ['pre*middle*suffix', 'premiddlesuffix', ['middle']],
    ['Plus *AI stack*, now', 'Plus AI stack, now', ['AI stack']],
    ['**bold**suffix', 'boldsuffix', ['bold']],
    ['  Plain   text\nonly  ', 'Plain text only', []],
    ['*still open', 'still open', ['still open']],
    ['<script>*safe*</script>', '<script>safe</script>', ['safe']],
    ['', '', []],
  ])('renders emphasis only within the delimiters in %j', (text, expected, emphasized) => {
    const wrapper = render(text);
    expect(wrapper.text()).toBe(expected);
    expect(wrapper.findAll('b').map(el => el.text())).toEqual(emphasized);
    expect(wrapper.find('script').exists()).toBe(false);
    expect(plain(text)).toBe(expected);
    wrapper.unmount();
  });
  it('removes trailing emphasis when a closing marker is inserted while editing', async () => {
    const wrapper = render('*word suffix');
    await wrapper.setProps({ text: '*word*suffix' });
    expect(wrapper.text()).toBe('wordsuffix');
    expect(wrapper.get('b').text()).toBe('word');
    wrapper.unmount();
  });
});
