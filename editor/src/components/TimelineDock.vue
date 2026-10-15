<script setup>
import Timeline from './Timeline.vue';
import { fmt, tc } from '../timing.js';

defineProps({
  state: { type: Object, required: true },
  duration: { type: Number, required: true },
  cur: { type: Number, required: true },
  selectedId: { type: Number, default: null },
  selectedChapterId: { type: Number, default: null },
  playing: { type: Boolean, required: true },
  offset: { type: Number, required: true },
  clips: { type: Array, default: () => [] },
});
const emit = defineEmits(['seek', 'toggle-play', 'select-chapter', 'select-headline', 'begin-edit', 'move-headline']);
</script>

<template>
  <section class="timeline-dock" aria-label="Timeline and playback">
    <div class="timeline-toolbar">
      <h2>Timeline <span id="durChip" class="chip">to {{ fmt(duration) }}</span></h2>
      <div class="transport">
        <button id="btnPlay" class="primary" @click="emit('toggle-play')">{{ playing ? 'Pause' : 'Play' }}</button>
        <input id="scrub" type="range" min="0" :max="duration" step="0.1" :value="cur" aria-label="Preview time"
          @input="emit('seek', +$event.target.value)">
        <div id="timelabel" class="timelabel">{{ fmt(cur) }}<small>{{ tc(cur, offset) }}</small></div>
      </div>
    </div>
    <Timeline :state="state" :duration="duration" :cur="cur" :selected-id="selectedId" :clips="clips"
      :selected-chapter-id="selectedChapterId" @seek="emit('seek', $event)"
      @select-chapter="emit('select-chapter', $event)" @select-headline="emit('select-headline', $event)"
      @begin-edit="emit('begin-edit')" @move-headline="(h, time) => emit('move-headline', h, time)" />
    <div class="timeline-legend">
      <span><i class="chapter-key"></i> Chapters</span>
      <span><i class="headline-key"></i> Headlines</span>
      <span><i class="invalid-key"></i> Outside chapter</span>
      <span v-if="clips.length"><i class="video-key"></i> Videos</span>
      <span class="timeline-help">Select a band to edit; drag to scrub; drag a headline's left edge to retime it. Gaps mean no headline.</span>
    </div>
  </section>
</template>
