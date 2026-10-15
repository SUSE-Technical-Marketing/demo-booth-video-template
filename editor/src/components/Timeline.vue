<script setup>
import { computed, ref } from 'vue';
import { activeChapter, chapterEnd, CH_COLORS, fmt, headlineChapter, headlineEnd, headlineOutside, headlineTime, plain } from '../timing.js';

const props = defineProps({
  state: { type: Object, required: true },
  duration: { type: Number, required: true },
  cur: { type: Number, required: true },
  selectedId: { type: Number, default: null },
  selectedChapterId: { type: Number, default: null },
  clips: { type: Array, default: () => [] },
});
const emit = defineEmits(['seek', 'select-chapter', 'select-headline', 'begin-edit', 'move-headline']);
const timeline = ref(null);
let dragging = false;
const pct = t => `${t / props.duration * 100}%`;
const clamp = t => Math.max(0, Math.min(props.duration, t));
const headlineBands = computed(() => props.state.headlines.map(headline => {
  const start = headlineTime(props.state, headline), end = headlineEnd(props.state, headline, props.duration);
  const chapter = headlineChapter(props.state, headline), outside = headlineOutside(props.state, headline, props.duration);
  return { headline, chapter, start, end, outside, marker: outside || end <= start };
}));
function headlineTitle(band) {
  return `${fmt(band.start)} – ${fmt(band.end)}  ${plain(band.headline.text)}${band.outside ? ' (outside chapter)' : ''}`;
}
const ruler = computed(() => {
  const step = props.duration > 600 ? 60 : 30, ticks = [];
  for (let t = 0; t <= props.duration; t += step) ticks.push({ t, label: t <= props.duration - step / 2 });
  return ticks;
});
// A handle sits on the left edge of each headline band. Dragging it moves where that headline starts, which is
// also where the previous headline in the chapter ends. It stays between its neighbours and inside its chapter.
const STEP = 0.1;
const handles = computed(() => headlineBands.value.filter(b => !b.outside && !b.marker).map(band => {
  const owned = props.state.headlines.filter(h => h.chapterId === band.chapter.id).sort((a, b) => a.t - b.t);
  const i = owned.indexOf(band.headline);
  const lower = i > 0 ? headlineTime(props.state, owned[i - 1]) + STEP : band.chapter.t;
  const next = owned[i + 1];
  const upper = Math.min(next ? headlineTime(props.state, next) - STEP : Infinity,
    chapterEnd(props.state, band.chapter, props.duration) - STEP, (props.state.headlines_end ?? Infinity) - STEP);
  return { band, lower, upper: Math.max(lower, upper) };
}));
const snap = t => Math.round(t / STEP) * STEP;
let handleDrag = null;
function moveTo(handle, time) {
  emit('move-headline', handle.band.headline, +Math.max(handle.lower, Math.min(handle.upper, snap(time))).toFixed(2));
}
function handleDown(event, handle) {
  handleDrag = handle;
  emit('begin-edit');
  event.currentTarget.setPointerCapture(event.pointerId);
}
function handleMove(event) {
  if (!handleDrag) return;
  const rect = timeline.value.getBoundingClientRect();
  moveTo(handleDrag, Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * props.duration);
}
function handleKey(event, handle) {
  const dir = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
  if (!dir) return;
  event.preventDefault();
  emit('begin-edit');
  moveTo(handle, handle.band.start + dir * (event.shiftKey ? 1 : STEP));
}
function seek(event) {
  const rect = timeline.value.getBoundingClientRect();
  emit('seek', Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * props.duration);
}
function pointerdown(event) {
  const headlineBand = event.target.closest('[data-headline-id]');
  const chapterBand = event.target.closest('[data-chapter-id]');
  if (headlineBand) emit('select-headline', props.state.headlines.find(h => h.id === +headlineBand.dataset.headlineId));
  else if (chapterBand) emit('select-chapter', props.state.chapter_starts.find(c => c.id === +chapterBand.dataset.chapterId));
  dragging = true;
  timeline.value.setPointerCapture(event.pointerId);
  seek(event);
}
function keyboardSelect(event, kind, row, start) {
  if (event.detail === 0) {
    emit(kind, row);
    emit('seek', clamp(start));
  }
}
</script>

<template>
  <div id="tl" ref="timeline" @pointerdown="pointerdown" @pointermove="dragging && seek($event)"
    @pointerup="dragging = false" @pointercancel="dragging = false" @lostpointercapture="dragging = false">
    <button v-for="chapter in state.chapter_starts" :key="chapter.id" class="band" :data-chapter-id="chapter.id"
      :class="{ sel: selectedChapterId === chapter.id, playing: activeChapter(state, cur) === chapter.ch }"
      :aria-pressed="selectedChapterId === chapter.id"
      :aria-label="`Edit chapter ${chapter.ch}: ${state.chapters[chapter.ch - 1]}`"
      :title="`${fmt(chapter.t)} – ${fmt(chapterEnd(state, chapter, duration))}`"
      :style="{ left: pct(clamp(chapter.t)), width: pct(Math.max(0, chapterEnd(state, chapter, duration) - chapter.t)),
        background: CH_COLORS[(chapter.ch - 1) % 6] }"
      @click="keyboardSelect($event, 'select-chapter', chapter, chapter.t)">{{ state.chapters[chapter.ch - 1] }}</button>
    <button v-for="band in headlineBands" :key="band.headline.id" class="headline-band" :data-headline-id="band.headline.id"
      :class="{ sel: selectedId === band.headline.id, owner: selectedChapterId === band.chapter.id,
        outside: band.outside, marker: band.marker }" :aria-pressed="selectedId === band.headline.id"
      :aria-label="`Edit headline in ${state.chapters[band.chapter.ch - 1]}: ${headlineTitle(band)}`"
      :title="headlineTitle(band)"
      :style="{ left: pct(clamp(band.start)), width: pct(band.marker ? 0 : band.end - band.start),
        '--band-color': CH_COLORS[(band.chapter.ch - 1) % 6] }"
      @click="keyboardSelect($event, 'select-headline', band.headline, band.start)">{{ plain(band.headline.text) }}</button>
    <div v-for="handle in handles" :key="'h' + handle.band.headline.id" class="headline-handle" role="slider" tabindex="0"
      :aria-label="`Move headline start: ${plain(handle.band.headline.text)}`" aria-orientation="horizontal"
      :aria-valuemin="handle.lower" :aria-valuemax="handle.upper" :aria-valuenow="handle.band.start"
      :aria-valuetext="fmt(handle.band.start)" :title="`Drag to move where this headline starts (${fmt(handle.band.start)})`"
      :style="{ left: pct(clamp(handle.band.start)) }" @pointerdown.stop="handleDown($event, handle)"
      @pointermove="handleMove" @pointerup="handleDrag = null" @pointercancel="handleDrag = null"
      @lostpointercapture="handleDrag = null" @keydown="handleKey($event, handle)"></div>
    <div v-for="clip in clips" :key="clip.id" class="vclip" :title="clip.name"
      :style="{ left: pct(clip.start), width: pct(clip.dur) }"></div>
    <div class="ruler">
      <template v-for="tick in ruler" :key="tick.t">
        <i :style="{ left: pct(tick.t) }"></i>
        <span v-if="tick.label" :style="{ left: pct(tick.t), ...(tick.t === 0 ? { transform: 'none', marginLeft: '2px' } : {}) }">{{ fmt(tick.t) }}</span>
      </template>
    </div>
    <div id="playhead" :style="{ left: pct(cur) }"></div>
  </div>
</template>
