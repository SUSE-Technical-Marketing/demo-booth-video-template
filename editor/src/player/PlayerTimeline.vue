<script setup>
import { computed, ref } from 'vue';
import { activeChapter, activeHeadline, chapterEnd, chapterLabels, chapterLevels, chapterNumber, CH_COLORS, headlineTime, plain } from '../timing.js';

const props = defineProps({
  state: { type: Object, required: true },        // with preview_end set to the video length
  total: { type: Number, required: true },
  cur: { type: Number, required: true },
  nested: { type: Boolean, default: false },      // the theme lists sub-chapters
});
const emit = defineEmits(['scrub', 'commit']);
const track = ref(null), hover = ref(null);
const clock = t => {
  const s = Math.max(0, Math.floor(t + 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
let dragging = false;

const levels = computed(() => chapterLevels(props.state, props.nested));
const parents = computed(() => levels.value.map((_, i) => levels.value.slice(0, i + 1).filter(l => !l).length));
const segments = computed(() => props.state.chapter_starts.map(chapter => {
  const sub = levels.value[chapter.ch - 1] === 1;
  return { id: chapter.id, ch: chapter.ch, sub, start: chapter.t, end: chapterEnd(props.state, chapter, props.total),
    title: props.state.chapters[chapter.ch - 1], color: CH_COLORS[(Math.max(1, parents.value[chapter.ch - 1]) - 1) % 6] };
}).filter(s => s.end > s.start));
const ticks = computed(() => props.state.headlines.map(h => headlineTime(props.state, h)).filter(t => t >= 0 && t < props.total));
const pct = t => `${Math.max(0, Math.min(1, t / Math.max(0.001, props.total))) * 100}%`;
const timeAt = event => {
  const box = track.value.getBoundingClientRect();
  return Math.max(0, Math.min(props.total, (event.clientX - box.left) / Math.max(1, box.width) * props.total));
};
function describe(t) {
  const chapter = activeChapter(props.state, t), labels = chapterLabels(levels.value);
  const headline = activeHeadline(props.state, t);
  return { t, left: pct(t), title: props.state.chapters[chapter - 1], label: labels[chapter - 1],
    headline: headline ? plain(headline.text) : '', number: chapterNumber(levels.value, chapter) };
}
function down(event) {
  if (event.button > 0) return;
  dragging = true;
  track.value.setPointerCapture?.(event.pointerId);
  emit('scrub', timeAt(event));
}
function move(event) {
  const t = timeAt(event);
  hover.value = describe(t);
  if (dragging) emit('scrub', t);
}
function up(event) {
  if (!dragging) return;
  dragging = false;
  emit('commit', timeAt(event));
  if (event.pointerType !== 'mouse') hover.value = null;
}
function cancel() {
  dragging = false;
  hover.value = null;
}
</script>

<template>
  <div ref="track" class="ptl" role="slider" tabindex="0" aria-label="Video timeline" :aria-valuemin="0"
    :aria-valuemax="Math.round(total)" :aria-valuenow="Math.round(cur)"
    :aria-valuetext="`${clock(cur)} of ${clock(total)}, ${describe(cur).title}`"
    @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="cancel" @pointerleave="hover = null">
    <div class="ptl-segments">
      <div v-for="segment in segments" :key="segment.id" class="ptl-seg" :class="{ sub: segment.sub }"
        :style="{ left: pct(segment.start), width: `${(segment.end - segment.start) / total * 100}%`, '--seg': segment.color }">
        <span class="ptl-label">{{ segment.title }}</span>
        <span class="ptl-time">{{ clock(segment.start) }}</span>
      </div>
    </div>
    <div class="ptl-progress" :style="{ width: pct(cur) }"></div>
    <div class="ptl-ticks" aria-hidden="true"><i v-for="(t, i) in ticks" :key="i" :style="{ left: pct(t) }"></i></div>
    <div class="ptl-head" :style="{ left: pct(cur) }"></div>
    <div v-if="hover" class="ptl-tip" :style="{ left: `clamp(60px, ${hover.left}, calc(100% - 60px))` }">
      <b>{{ clock(hover.t) }}</b> · {{ hover.label }} {{ hover.title }}<template v-if="hover.headline"> — {{ hover.headline }}</template>
    </div>
  </div>
</template>
