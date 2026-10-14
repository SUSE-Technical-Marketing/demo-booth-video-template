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
const emit = defineEmits(['seek', 'select-chapter', 'select-headline']);
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
