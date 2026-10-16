import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import VideoList from './VideoList.vue';

const clips = ['a', 'b', 'c'].map((id, i) => ({
  id, name: `${id}.mp4`, start: i * 10, dur: 10, source_in: 0, source_out: 10,
}));
const setup = () => mount(VideoList, { props: { clips, starts: [], linkMedia: vi.fn().mockResolvedValue() } });
const transfer = () => ({ effectAllowed: '', dropEffect: '', setData: vi.fn() });

describe('clip order controls', () => {
  it('uses a labelled grip on each reorderable row rather than a text button', async () => {
    const wrapper = setup();
    expect(wrapper.findAll('.vrow.reorderable')).toHaveLength(3);
    const grip = wrapper.get('.clip-drag');
    expect(grip.text()).toBe('');
    expect(grip.attributes('aria-label')).toBe('Drag to reorder clip 1: a.mp4');
    expect(grip.get('svg').attributes('aria-hidden')).toBe('true');
    expect(grip.findAll('circle')).toHaveLength(6);
    await wrapper.setProps({ clips: clips.slice(0, 1) });
    expect(wrapper.find('.clip-drag').exists()).toBe(false);
    expect(wrapper.find('.reorderable').exists()).toBe(false);
    wrapper.unmount();
  });

  describe('shared media relinking popover', () => {
    const media = () => [
      { ...clips[0], media_id: 'recording', path: 'recording.mp4', resolvedPath: 'media/recording.mp4' },
      { ...clips[1], media_id: 'recording', freeze: true },
      { ...clips[2], media_id: 'linked', url: 'blob:linked', sourceDuration: 10 },
    ];
    async function open(wrapper) {
      const popover = wrapper.get('#media-relink-popover').element;
      const toggle = newState => {
        const event = new Event('toggle');
        Object.defineProperty(event, 'newState', { value: newState });
        popover.dispatchEvent(event);
      };
      popover.showPopover = vi.fn(() => toggle('open'));
      popover.hidePopover = vi.fn(() => toggle('closed'));
      await wrapper.get('#btnRelinkMedia').trigger('click');
      return popover;
    }
    async function choose(wrapper, file = new File(['video'], 'source.mp4')) {
      await wrapper.get('.relink-item .relink-media').trigger('click');
      const input = wrapper.get('#relinkFile');
      Object.defineProperty(input.element, 'files', { configurable: true, value: file ? [file] : [] });
      await input.trigger('change');
      await flushPromises();
      return file;
    }
    it('has one shared action and groups missing clips and freezes using the same source', async () => {
      const wrapper = mount(VideoList, { props: { clips: media(), starts: [], linkMedia: vi.fn() } });
      expect(wrapper.find('#vlist .relink-media').exists()).toBe(false);
      expect(wrapper.get('#btnRelinkMedia').text()).toContain('1 missing');
      const popover = await open(wrapper);
      expect(popover.showPopover).toHaveBeenCalledOnce();
      expect(wrapper.get('#btnRelinkMedia').attributes('aria-expanded')).toBe('true');
      expect(wrapper.findAll('.relink-item')).toHaveLength(1);
      expect(wrapper.get('.relink-item').text()).toContain('Clips 1, 2');
      expect(wrapper.get('.relink-item').text()).toContain('media/recording.mp4');
      await wrapper.get('#media-relink-popover input[type=checkbox]').setValue(true);
      expect(wrapper.findAll('.relink-item')).toHaveLength(2);
      await wrapper.get('.relink-close').trigger('click');
      expect(popover.hidePopover).toHaveBeenCalledOnce();
      expect(wrapper.get('#btnRelinkMedia').attributes('aria-expanded')).toBe('false');
      wrapper.unmount();
    });
    it('supports a source used only by a freeze and detects invalid trim references', async () => {
      const wrapper = mount(VideoList, { props: {
        clips: [{ ...clips[0], freeze: true }, { ...clips[1], url: 'blob:short', sourceDuration: 5 }],
        starts: [], linkMedia: vi.fn(),
      } });
      await open(wrapper);
      expect(wrapper.findAll('.relink-item')).toHaveLength(2);
      expect(wrapper.get('#btnRelinkMedia').text()).toContain('2 missing');
      wrapper.unmount();
    });
    it('waits for relinking, then removes repaired sources from the queue', async () => {
      const pending = Promise.withResolvers(), linkMedia = vi.fn(() => pending.promise);
      const original = media();
      const wrapper = mount(VideoList, { attachTo: document.body, props: { clips: original, starts: [], linkMedia } });
      await open(wrapper);
      const file = await choose(wrapper);
      expect(linkMedia).toHaveBeenCalledWith(original[0], file);
      expect(wrapper.get('.relink-media').element.disabled).toBe(true);
      expect(wrapper.get('#media-relink-popover').attributes('aria-busy')).toBe('true');
      await wrapper.setProps({ clips: original.map(c => ({ ...c, url: 'blob:linked' })) });
      pending.resolve();
      await flushPromises();
      expect(wrapper.findAll('.relink-item')).toHaveLength(0);
      expect(wrapper.get('#media-relink-popover').text()).toContain('All media is linked.');
      expect(document.activeElement).toBe(wrapper.get('.relink-close').element);
      wrapper.unmount();
    });
    it('shows errors inside the popover and permits retry without losing the missing entry', async () => {
      const linkMedia = vi.fn().mockRejectedValueOnce(new Error('Cannot decode this video')).mockResolvedValue();
      const wrapper = mount(VideoList, { props: { clips: media(), starts: [], linkMedia } });
      await open(wrapper);
      await choose(wrapper);
      expect(wrapper.get('.relink-error').text()).toBe('Cannot decode this video');
      expect(wrapper.emitted('error')).toEqual([['Cannot decode this video']]);
      expect(wrapper.get('.relink-media').element.disabled).toBe(false);
      await choose(wrapper);
      expect(wrapper.find('.relink-error').exists()).toBe(false);
      expect(linkMedia).toHaveBeenCalledTimes(2);
      wrapper.unmount();
    });
    it('handles picker cancellation, an empty project, and unavailable popover support explicitly', async () => {
      const linkMedia = vi.fn();
      const wrapper = mount(VideoList, { props: { clips: media(), starts: [], linkMedia } });
      await open(wrapper);
      await choose(wrapper, null);
      expect(linkMedia).not.toHaveBeenCalled();
      wrapper.get('#media-relink-popover').element.showPopover = () => { throw new Error('Not supported'); };
      await wrapper.get('#btnRelinkMedia').trigger('click');
      expect(wrapper.emitted('error').at(-1)[0]).toContain('Not supported');
      await wrapper.setProps({ clips: [] });
      expect(wrapper.get('#btnRelinkMedia').element.disabled).toBe(true);
      wrapper.unmount();
    });
  });
  it('provides keyboard-accessible moves before the previous or after the next clip', async () => {
    const wrapper = setup();
    expect(wrapper.get('[aria-label="Move clip 1 up"]').element.disabled).toBe(true);
    expect(wrapper.get('[aria-label="Move clip 3 down"]').element.disabled).toBe(true);
    await wrapper.get('[aria-label="Move clip 2 up"]').trigger('click');
    await wrapper.get('[aria-label="Move clip 1 down"]').trigger('click');
    await wrapper.get('[aria-label="Move clip 2 down"]').trigger('click');
    expect(wrapper.emitted('reorder')).toEqual([['b', 'a'], ['a', 'c'], ['b', null]]);
    wrapper.unmount();
  });
  it('shows insertion feedback above or below a row and clears it on drop or cancellation', async () => {
    const wrapper = setup(), dataTransfer = transfer();
    const rows = wrapper.findAll('.vrow');
    vi.spyOn(rows[0].element, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 100 });
    await wrapper.get('[draggable=true]').trigger('dragstart', { dataTransfer });
    expect(dataTransfer.effectAllowed).toBe('move');
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'a');
    await rows[0].trigger('dragover', { dataTransfer, clientY: 75 });
    expect(rows[1].classes()).toContain('drop-before');
    await rows[0].trigger('drop', { dataTransfer });
    expect(wrapper.emitted('reorder')).toEqual([['a', 'b']]);
    expect(wrapper.find('.dragging').exists()).toBe(false);
    expect(wrapper.find('.drop-before').exists()).toBe(false);
    await wrapper.get('[draggable=true]').trigger('dragstart', { dataTransfer });
    await rows[0].trigger('dragover', { dataTransfer, clientY: 25 });
    expect(rows[0].classes()).toContain('drop-before');
    await wrapper.get('[draggable=true]').trigger('dragend');
    expect(wrapper.find('.drop-before').exists()).toBe(false);
    wrapper.unmount();
  });
  it('supports dropping at the end and ignores external file or text drags', async () => {
    const wrapper = setup(), dataTransfer = transfer(), rows = wrapper.findAll('.vrow');
    vi.spyOn(rows[2].element, 'getBoundingClientRect').mockReturnValue({ top: 200, height: 100 });
    await rows[2].trigger('dragover', { dataTransfer, clientY: 275 });
    await rows[2].trigger('drop', { dataTransfer });
    expect(wrapper.emitted('reorder')).toBeUndefined();
    await wrapper.get('[draggable=true]').trigger('dragstart', { dataTransfer });
    await rows[2].trigger('dragover', { dataTransfer, clientY: 275 });
    expect(rows[2].classes()).toContain('drop-after');
    await rows[2].trigger('drop', { dataTransfer });
    expect(wrapper.emitted('reorder')).toEqual([['a', null]]);
    wrapper.unmount();
  });
});
