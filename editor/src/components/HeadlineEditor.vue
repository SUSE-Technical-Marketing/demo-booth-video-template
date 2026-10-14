<script setup>
import { ref } from 'vue';
import HeadlineRow from './HeadlineRow.vue';

const props = defineProps({
  headlines: { type: Array, required: true },
  end: { type: Number, default: null },
  offset: { type: Number, required: true },
  selectedId: { type: Number, default: null },
  textSizeIndex: { type: Number, required: true },
});
const emit = defineEmits(['begin-edit', 'update-time', 'commit-time', 'error', 'select',
  'update-text', 'add-headline', 'set-playhead', 'delete-headline']);
const headlinesList = ref(null);
function rowDuration(i) {
  const end = Math.min(props.headlines[i + 1]?.t ?? Infinity, props.end ?? Infinity);
  return end === Infinity ? null : end - props.headlines[i].t;
}
function focusHeadline(id, focus = false) {
  const row = headlinesList.value.querySelector(`[data-row-id="${id}"]`);
  row?.scrollIntoView({ block: focus ? 'center' : 'nearest', behavior: 'smooth' });
  if (focus && row) {
    const input = row.querySelector('input:not(.time)');
    input.focus();
    input.select();
  }
}
defineExpose({ focusHeadline });
</script>

<template>
  <section class="headline-editor">
    <div class="headline-list" ref="headlinesList">
      <p v-if="!headlines.length" class="empty-state">No headlines in this chapter. Add one below.</p>
      <HeadlineRow v-for="(headline, i) in headlines" :key="headline.id" :headline="headline" :offset="offset"
        :selected="selectedId === headline.id" :duration="rowDuration(i)" :sets-text-size="textSizeIndex === i"
        :outside="headline.t < 0 || (end != null && headline.t >= end)"
        @begin-edit="emit('begin-edit')" @update-time="emit('update-time', headline, $event)"
        @commit-time="emit('commit-time')" @error="emit('error', $event)" @select="emit('select', headline)"
        @update-text="emit('update-text', headline, $event)" @add-after="emit('add-headline', headline)"
        @set-playhead="emit('set-playhead', headline)" @delete="emit('delete-headline', headline)" />
    </div>
    <div class="tools">
      <button class="add-headline" @click="emit('add-headline')">+ Add headline</button>
    </div>
  </section>
</template>
