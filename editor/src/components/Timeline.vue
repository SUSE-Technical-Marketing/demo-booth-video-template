<script setup>
import { computed, ref } from 'vue';
import { CH_COLORS, fmt, plain } from '../timing.js';

const props = defineProps({
  state: { type: Object, required: true },
  duration: { type: Number, required: true },
  cur: { type: Number, required: true },
  selectedId: { type: Number, default: null },
  clips: { type: Array, default: () => [] },
});
const emit = defineEmits(['seek']);
const timeline = ref(null);
let dragging = false;
const pct = t => `${t / props.duration * 100}%`;
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
  dragging = true;
  timeline.value.setPointerCapture(event.pointerId);
  seek(event);
}
</script>

<template>
  <div id="tl" ref="timeline" @pointerdown="pointerdown" @pointermove="dragging && seek($event)"
    @pointerup="dragging = false" @pointercancel="dragging = false" @lostpointercapture="dragging = false">
    <div v-for="(chapter, i) in state.chapter_starts" :key="chapter.id" class="band"
      :title="`${fmt(chapter.t)} – ${fmt(state.chapter_starts[i + 1]?.t ?? duration)}`"
      :style="{ left: pct(chapter.t), width: pct((state.chapter_starts[i + 1]?.t ?? duration) - chapter.t),
        background: CH_COLORS[(chapter.ch - 1) % 6] }">{{ state.chapters[chapter.ch - 1] || `Chapter ${chapter.ch}` }}</div>
    <div v-for="headline in state.headlines" :key="headline.id" class="tick" :class="{ sel: selectedId === headline.id }"
      :title="`${fmt(headline.t)}  ${plain(headline.text)}`" :style="{ left: pct(headline.t) }"></div>
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
