<script setup>
import Timeline from './Timeline.vue';
import { fmt, tc } from '../timing.js';

defineProps({
  state: { type: Object, required: true },
  duration: { type: Number, required: true },
  cur: { type: Number, required: true },
  selectedId: { type: Number, default: null },
  playing: { type: Boolean, required: true },
  offset: { type: Number, required: true },
  clips: { type: Array, default: () => [] },
});
const emit = defineEmits(['seek', 'toggle-play']);
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
    <Timeline :state="state" :duration="duration" :cur="cur" :selected-id="selectedId" :clips="clips" @seek="emit('seek', $event)" />
    <div class="timeline-legend">
      <span><i class="chapter-key"></i> Chapters</span>
      <span><i class="headline-key"></i> Headline cues</span>
      <span v-if="clips.length"><i class="video-key"></i> Videos</span>
      <span class="timeline-help">Click or drag to scrub; click an editor row to jump to it.</span>
    </div>
  </section>
</template>
