<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { activeChapter, chapterEnd, CH_COLORS, fmt, headlineChapter, headlineEnd, headlineOutside, headlineTime, plain } from '../timing.js';

const props = defineProps({
  state: { type: Object, required: true },
  duration: { type: Number, required: true },
  cur: { type: Number, required: true },
  selectedId: { type: Number, default: null },
  selectedChapterId: { type: Number, default: null },
  clips: { type: Array, default: () => [] },
  zoom: { type: Number, default: 1 },
});
const emit = defineEmits(['seek', 'select-chapter', 'select-headline', 'begin-edit', 'move-headline', 'move-headline-end', 'move-chapter', 'zoom']);
const timeline = ref(null), scroller = ref(null);
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
  // aim for roughly a dozen labels across what is visible, so zooming in adds finer ticks
  const visible = props.duration / props.zoom;
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(s => visible / s <= 12) ?? 600, ticks = [];
  for (let t = 0; t <= props.duration; t += step) ticks.push({ t, label: t <= props.duration - step / 2 });
  return ticks;
});
// Each headline band has two handles. The one on its left edge moves when the words appear (and, since a headline
// normally ends where the next begins, where the previous one ends). The one on its right edge moves when the words
// disappear, which can leave a gap before the next headline; dragging it all the way to the next headline (or the
// chapter end) goes back to "automatic". Handles stay between the neighbours and inside the chapter.
const STEP = 0.1;
const handles = computed(() => headlineBands.value.filter(b => !b.outside && !b.marker).flatMap(band => {
  const owned = props.state.headlines.filter(h => h.chapterId === band.chapter.id).sort((a, b) => a.t - b.t);
  const i = owned.indexOf(band.headline), next = owned[i + 1];
  const limit = Math.min(next ? headlineTime(props.state, next) : Infinity,
    chapterEnd(props.state, band.chapter, props.duration), props.state.headlines_end ?? Infinity);
  const startLower = i > 0 ? headlineTime(props.state, owned[i - 1]) + STEP : band.chapter.t;
  const startUpper = Math.max(startLower, Math.min(limit - STEP,
    band.headline.end == null ? Infinity : band.chapter.t + band.headline.end - STEP));
  const endLower = band.start + STEP;
  return [
    { kind: 'start', band, lower: startLower, upper: startUpper, value: band.start },
    { kind: 'end', band, lower: endLower, upper: Math.max(endLower, limit), value: band.end },
  ];
}));
// A handle on the left edge of each chapter band moves where that chapter starts (the previous chapter ends there).
// Its headlines are measured from its start, so they move with it. It stays between the neighbouring chapters.
const chapterHandles = computed(() => props.state.chapter_starts.map((chapter, i) => {
  const next = props.state.chapter_starts[i + 1];
  const lower = i > 0 ? props.state.chapter_starts[i - 1].t + STEP : 0;
  const upper = Math.min(next ? next.t - STEP : Infinity, (props.state.chapters_end ?? Infinity) - STEP);
  return { kind: 'chapter', chapter, lower, upper: Math.max(lower, upper), value: chapter.t };
}));
const snap = t => Math.round(t / STEP) * STEP;
let handleDrag = null;
function moveTo(handle, time) {
  const clamped = +Math.max(handle.lower, Math.min(handle.upper, snap(time))).toFixed(2);
  if (handle.kind === 'chapter') emit('move-chapter', handle.chapter, clamped);
  else if (handle.kind === 'start') emit('move-headline', handle.band.headline, clamped);
  else emit('move-headline-end', handle.band.headline, clamped >= handle.upper - 1e-6 ? null : clamped);
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
  moveTo(handle, handle.value + dir * (event.shiftKey ? 1 : STEP));
}
// Zooming keeps whatever is at the same spot on screen (the playhead if it is visible, else the middle) in place.
watch(() => props.zoom, async (zoom, before) => {
  const view = scroller.value;
  if (!view || !view.clientWidth) return;
  const width = view.clientWidth, playheadX = props.cur / props.duration * width * before;
  const onScreen = playheadX >= view.scrollLeft && playheadX <= view.scrollLeft + width;
  const anchorX = onScreen ? playheadX : view.scrollLeft + width / 2, offset = anchorX - view.scrollLeft;
  const fraction = anchorX / (width * before);
  await nextTick();
  view.scrollLeft = fraction * width * zoom - offset;
});
// When zoomed in, scroll to keep the playhead in view (playing, or jumping to a chapter or headline).
watch(() => props.cur, time => {
  const view = scroller.value;
  if (!view || props.zoom <= 1 || !view.clientWidth || dragging) return;
  const x = time / props.duration * view.clientWidth * props.zoom, margin = view.clientWidth * 0.1;
  if (x < view.scrollLeft + margin || x > view.scrollLeft + view.clientWidth - margin) {
    view.scrollLeft = Math.max(0, x - view.clientWidth * 0.25);
  }
});
function wheel(event) {              // Ctrl/Cmd + scroll, or a trackpad pinch, zooms
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  emit('zoom', event.deltaY < 0 ? 1 : -1);
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
  <div ref="scroller" class="tl-scroll" @wheel="wheel">
  <div id="tl" ref="timeline" :style="{ width: `${zoom * 100}%` }" @pointerdown="pointerdown" @pointermove="dragging && seek($event)"
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
    <div v-for="handle in chapterHandles" :key="'c' + handle.chapter.id" class="chapter-handle" role="slider" tabindex="0"
      data-handle="chapter" :aria-label="`Move chapter start: ${state.chapters[handle.chapter.ch - 1]}`"
      aria-orientation="horizontal" :aria-valuemin="handle.lower" :aria-valuemax="handle.upper" :aria-valuenow="handle.value"
      :aria-valuetext="fmt(handle.value)" :title="`Drag to move where this chapter starts (${fmt(handle.value)}); its headlines move with it`"
      :style="{ left: pct(clamp(handle.value)) }" @pointerdown.stop="handleDown($event, handle)"
      @pointermove="handleMove" @pointerup="handleDrag = null" @pointercancel="handleDrag = null"
      @lostpointercapture="handleDrag = null" @keydown="handleKey($event, handle)"></div>
    <div v-for="handle in handles" :key="handle.kind + handle.band.headline.id" class="headline-handle" :class="handle.kind"
      role="slider" tabindex="0" :data-handle="handle.kind"
      :aria-label="`Move headline ${handle.kind}: ${plain(handle.band.headline.text)}`" aria-orientation="horizontal"
      :aria-valuemin="handle.lower" :aria-valuemax="handle.upper" :aria-valuenow="handle.value"
      :aria-valuetext="fmt(handle.value)"
      :title="`Drag to move where this headline ${handle.kind === 'start' ? 'starts' : 'ends'} (${fmt(handle.value)})`"
      :style="{ left: pct(clamp(handle.value)) }" @pointerdown.stop="handleDown($event, handle)"
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
  </div>
</template>
