<script setup>
import { computed, ref } from 'vue';
import HeadlineRow from './HeadlineRow.vue';
import { fmt } from '../timing.js';

const props = defineProps({
  headlines: { type: Array, required: true },
  end: { type: Number, default: null },
  wipe: { type: Number, required: true },
  offset: { type: Number, required: true },
  selectedId: { type: Number, default: null },
  textSizeIndex: { type: Number, required: true },
});
const emit = defineEmits(['begin-edit', 'update-time', 'commit-time', 'error', 'select',
  'update-text', 'add-headline', 'set-playhead', 'delete-headline', 'change-end', 'change-wipe']);
const headlinesList = ref(null);
const endText = computed(() => props.end == null ? '' : fmt(props.end));
function rowDuration(i) {
  const end = props.headlines[i + 1]?.t ?? props.end;
  return end == null ? null : end - props.headlines[i].t;
}
function focusHeadline(id, focus = false) {
  const row = headlinesList.value.querySelector(`[data-row-id="${id}"]`);
  row?.scrollIntoView({ block: focus ? 'center' : 'nearest', behavior: 'smooth' });
  if (focus) row?.querySelector('input:not(.time)').select();
}
defineExpose({ focusHeadline });
</script>

<template>
  <section class="card">
    <h2>Headlines</h2>
    <div id="headlines" ref="headlinesList">
      <HeadlineRow v-for="(headline, i) in headlines" :key="headline.id" :headline="headline" :offset="offset"
        :selected="selectedId === headline.id" :duration="rowDuration(i)" :sets-text-size="textSizeIndex === i"
        @begin-edit="emit('begin-edit')" @update-time="emit('update-time', headline, $event)"
        @commit-time="emit('commit-time')" @error="emit('error', $event)" @select="emit('select', headline)"
        @update-text="emit('update-text', headline, $event)" @add-after="emit('add-headline', headline)"
        @set-playhead="emit('set-playhead', headline)" @delete="emit('delete-headline', headline)" />
    </div>
    <div class="tools">
      <button id="addHeadline" @click="emit('add-headline')">+ Add headline</button>
      <label class="inline">last headline ends at <input id="endAt" :value="endText" size="7" placeholder="clip end" @change="emit('change-end', $event)"></label>
      <label class="inline">wipe <input id="wipe" :value="wipe" type="number" min="0" max="3" step="0.1" @change="emit('change-wipe', $event)"> s</label>
    </div>
    <p class="hint">Wrap words in <kbd>*asterisks*</kbd> for the orange accent. Time fields take <kbd>3:44</kbd>, <kbd>224</kbd> or timeline
      timecode <kbd>1:03:44</kbd>; <kbd>↑</kbd><kbd>↓</kbd> nudge 1 s (<kbd>Shift</kbd> 5 s, <kbd>Alt</kbd> 0.1 s).
      <kbd>Enter</kbd> in a headline adds one below.</p>
  </section>
</template>
