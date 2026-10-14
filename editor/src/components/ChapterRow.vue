<script setup>
import DurationBadge from './DurationBadge.vue';
import TimeInput from './TimeInput.vue';
import { CH_COLORS } from '../timing.js';

defineProps({
  chapter: { type: Object, required: true },
  title: { type: String, required: true },
  offset: { type: Number, required: true },
  duration: { type: Number, required: true },
});
const emit = defineEmits(['begin-edit', 'update-time', 'commit-time', 'error', 'select',
  'delete', 'update-title']);
</script>

<template>
  <div class="crow" @click="emit('select')">
    <TimeInput :model-value="chapter.t" :offset="offset" @begin-edit="emit('begin-edit')"
      @update:model-value="emit('update-time', $event)" @commit="emit('commit-time')" @error="emit('error', $event)" />
    <div class="textcell">
      <div><span class="dot" :style="{ background: CH_COLORS[(chapter.ch - 1) % 6] }"></span>
        <span class="chapter-number">{{ chapter.ch }}</span>
        <input class="chapter-title" :value="title" placeholder="Chapter title" :aria-label="`Chapter ${chapter.ch} title`"
          :data-chapter="chapter.ch" @click.stop @focus="emit('begin-edit')"
          @input="emit('update-title', $event.target.value)">
      </div>
      <DurationBadge :duration="duration" class="meta chapter-duration"
        title="Duration until the next chapter or preview end." />
    </div>
    <button class="icon ghost" title="Delete chapter" @click.stop="emit('delete')">✕</button>
  </div>
</template>
