<script setup>
import { computed, ref } from 'vue';
import Timeline from './Timeline.vue';
import { fmt, tc } from '../timing.js';

const props = defineProps({
  state: { type: Object, required: true },
  duration: { type: Number, required: true },
  cur: { type: Number, required: true },
  selectedId: { type: Number, default: null },
  selectedChapterId: { type: Number, default: null },
  playing: { type: Boolean, required: true },
  offset: { type: Number, required: true },
  clips: { type: Array, default: () => [] },
  tool: { type: String, default: null },            // 'freeze', 'cut' or 'insert' while that editing tool is open
  cutRange: { type: Object, default: null },
});
// Zoom is a view setting only: 1 fits the whole video, each step doubles it (up to about 10 s across).
const zoom = ref(1);
// Show the loaded videos as a row above the chapters; remembered between visits.
const STORE = 'timeline_show_videos';
function initialVideos() { try { return localStorage.getItem(STORE) !== '0'; } catch { return true; } }
const showVideos = ref(initialVideos());
function toggleVideos() {
  showVideos.value = !showVideos.value;
  try { localStorage.setItem(STORE, showVideos.value ? '1' : '0'); } catch { /* the toggle still works for this visit */ }
}
const maxZoom = computed(() => Math.max(1, Math.min(64, 2 ** Math.floor(Math.log2(props.duration / 10)))));
const zoomIn = () => { zoom.value = Math.min(maxZoom.value, zoom.value * 2); };
const zoomOut = () => { zoom.value = Math.max(1, zoom.value / 2); };
function zoomBy(direction) { if (direction > 0) zoomIn(); else zoomOut(); }
const emit = defineEmits(['seek', 'toggle-play', 'select-chapter', 'select-headline', 'begin-edit', 'move-headline',
  'move-headline-end', 'move-chapter', 'trim-clip', 'tool', 'update-cut']);
</script>

<template>
  <section class="timeline-dock" aria-label="Timeline and playback">
    <div class="timeline-toolbar">
      <h2>Timeline <span id="durChip" class="chip">to {{ fmt(duration) }}</span></h2>
      <div class="zoom" role="group" aria-label="Timeline zoom">
        <button id="zoomOut" class="icon ghost" title="Zoom out (Ctrl/Cmd + scroll)" aria-label="Zoom out" :disabled="zoom <= 1" @click="zoomOut">−</button>
        <span id="zoomLabel" class="zoom-label" aria-live="polite">{{ zoom === 1 ? 'Fit' : `×${zoom}` }}</span>
        <button id="zoomIn" class="icon ghost" title="Zoom in (Ctrl/Cmd + scroll)" aria-label="Zoom in" :disabled="zoom >= maxZoom" @click="zoomIn">+</button>
        <button id="zoomFit" class="ghost" title="Show the whole video" :disabled="zoom === 1" @click="zoom = 1">Fit</button>
        <button id="toggleVideos" class="ghost videos-toggle" :aria-pressed="showVideos && clips.length > 0" :disabled="!clips.length"
          :title="clips.length ? 'Show or hide the loaded videos above the chapters' : 'Add a video to see it on the timeline'"
          @click="toggleVideos">Videos</button>
      </div>
      <div class="edit-tools" role="group" aria-label="Editing tools">
        <button id="btnInsert" class="ghost" :aria-pressed="tool === 'insert'" :disabled="!clips.length"
          :title="clips.length ? 'Put another video in at the playhead and push the rest of the video later' : 'Add a video to use this'"
          @click="emit('tool', 'insert')">Insert video…</button>
        <button id="btnFreeze" class="ghost" :aria-pressed="tool === 'freeze'" :disabled="!clips.length"
          :title="clips.length ? 'Hold the frame at the playhead for a few seconds' : 'Add a video to use this'"
          @click="emit('tool', 'freeze')">Freeze frame…</button>
        <button id="btnCut" class="ghost" :aria-pressed="tool === 'cut'" :disabled="!clips.length"
          :title="clips.length ? 'Remove a section of video and close the gap (ripple delete)' : 'Add a video to use this'"
          @click="emit('tool', 'cut')">Cut section…</button>
      </div>
      <div class="transport">
        <button id="btnPlay" class="primary" @click="emit('toggle-play')">{{ playing ? 'Pause' : 'Play' }}</button>
        <input id="scrub" type="range" min="0" :max="duration" step="0.1" :value="cur" aria-label="Preview time"
          @input="emit('seek', +$event.target.value)">
        <div id="timelabel" class="timelabel">{{ fmt(cur) }}<small>{{ tc(cur, offset) }}</small></div>
      </div>
    </div>
    <slot name="tool"></slot>
    <Timeline :state="state" :duration="duration" :cur="cur" :selected-id="selectedId" :clips="clips"
      :selected-chapter-id="selectedChapterId" :zoom="zoom" :show-videos="showVideos" :cut-range="cutRange" @zoom="zoomBy"
      @update-cut="emit('update-cut', $event)" @seek="emit('seek', $event)"
      @select-chapter="emit('select-chapter', $event)" @select-headline="emit('select-headline', $event)"
      @begin-edit="emit('begin-edit')" @move-headline="(h, time) => emit('move-headline', h, time)"
      @move-headline-end="(h, time) => emit('move-headline-end', h, time)"
      @move-chapter="(c, time) => emit('move-chapter', c, time)"
      @trim-clip="(clip, patch, time) => emit('trim-clip', clip, patch, time)" />
    <div class="timeline-legend">
      <span><i class="chapter-key"></i> Chapters</span>
      <span><i class="headline-key"></i> Headlines</span>
      <span><i class="invalid-key"></i> Outside chapter</span>
      <span v-if="clips.length"><i class="video-key"></i> Videos</span>
      <span v-if="clips.some(c => c.freeze)"><i class="freeze-key"></i> Freeze frame</span>
      <span class="timeline-help">Select a band to edit; drag to scrub; drag chapter/headline edges to retime or video edges to trim.</span>
    </div>
  </section>
</template>
