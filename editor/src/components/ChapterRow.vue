<script setup>
import DurationBadge from './DurationBadge.vue';
import TimeInput from './TimeInput.vue';
import { CH_COLORS } from '../timing.js';

defineProps({
  chapter: { type: Object, required: true },
  chapters: { type: Array, required: true },
  offset: { type: Number, required: true },
  duration: { type: Number, required: true },
});
const emit = defineEmits(['begin-edit', 'update-time', 'commit-time', 'error', 'select',
  'choose-chapter', 'delete', 'update-title']);
</script>

<template>
  <div class="crow" @click="emit('select')">
    <TimeInput :model-value="chapter.t" :offset="offset" @begin-edit="emit('begin-edit')"
      @update:model-value="emit('update-time', $event)" @commit="emit('commit-time')" @error="emit('error', $event)" />
    <div class="textcell">
      <div><span class="dot" :style="{ background: CH_COLORS[(chapter.ch - 1) % 6] }"></span>
        <select :value="chapter.ch" aria-label="Chapter button" @change="emit('choose-chapter', +$event.target.value)">
          <option v-for="(title, i) in chapters" :key="i" :value="i + 1">{{ i + 1 }} {{ title }}</option>
        </select>
      </div>
      <DurationBadge :duration="duration" class="meta chapter-duration"
        title="Duration until the next chapter switch or preview end." />
    </div>
    <!-- <input class="chapter-title" :value="chapters[chapter.ch - 1]" placeholder="Chapter title" :aria-label="`Chapter ${chapter.ch} title`"
      :data-inline-chapter="chapter.ch" @click.stop @focus="emit('begin-edit')"
      @input="emit('update-title', $event.target.value)"> -->
    <button class="icon ghost" title="Delete" @click.stop="emit('delete')">✕</button>
  </div>
</template>
