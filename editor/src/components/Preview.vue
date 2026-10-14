<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import AccentText from './AccentText.vue';
import { activeChapter, activeHeadline, chapterScrollAt, chapterScrollSteps, CHAPTER_SCROLL, CHAPTER_VIEW, TEXT_SCALE } from '../timing.js';

const props = defineProps({
  state: { type: Object, required: true },
  cur: { type: Number, required: true },
  headlinePx: { type: Number, required: true },
  pillPx: { type: Number, required: true },
  productPx: { type: Number, required: true },
});
const view = ref(null), scale = ref(1), logoFailed = ref(false);
let observer;
onMounted(() => {
  observer = new ResizeObserver(() => { scale.value = view.value.clientWidth / 1920; });
  observer.observe(view.value);
  scale.value = view.value.clientWidth / 1920;
});
onUnmounted(() => observer?.disconnect());
const steps = computed(() => chapterScrollSteps(props.state));
const offset = computed(() => chapterScrollAt(props.cur, steps.value));
const active = computed(() => activeChapter(props.state, props.cur));
const headline = computed(() => activeHeadline(props.state, props.cur));
const scrolling = computed(() => props.state.chapters.length > CHAPTER_SCROLL.visible);
const count = computed(() => Math.min(props.state.chapters.length, CHAPTER_SCROLL.visible));
const viewportStyle = {
  left: `${CHAPTER_VIEW.cx - CHAPTER_VIEW.w / 2}px`, top: `${CHAPTER_VIEW.cy - CHAPTER_VIEW.h / 2}px`,
  width: `${CHAPTER_VIEW.w}px`, height: `${CHAPTER_VIEW.h}px`,
};
function pillStyle(i) {
  return { fontSize: `${props.pillPx}px`,
    top: `${977 - (count.value - i - 1 + offset.value) * 126 - 54 - (CHAPTER_VIEW.cy - CHAPTER_VIEW.h / 2)}px` };
}
function indicatorStyle(x, y, width) {
  return { left: `${x - width / 2}px`, top: `${y - CHAPTER_SCROLL.indicator_px * TEXT_SCALE / 2}px`,
    width: `${width}px`, fontSize: `${CHAPTER_SCROLL.indicator_px * TEXT_SCALE}px` };
}
const headlineStyle = computed(() => {
  const progress = headline.value ? Math.max(0, Math.min(1, (props.cur - headline.value.t) / Math.max(0.01, props.state.wipe_seconds))) : 1;
  return { fontSize: `${props.headlinePx}px`, clipPath: `inset(-20px ${(1 - progress) * 100}% -20px -12px)` };
});
</script>

<template>
  <div id="view" ref="view">
    <div id="stage" :style="{ transform: `scale(${scale})` }">
      <div id="panel" class="abs"></div>
      <img v-if="!logoFailed" id="logo" class="abs" src="https://www.suse.com/assets/img/suse-white-logo-green.svg"
        alt="SUSE" @error="logoFailed = true">
      <div v-else id="logoFallback" class="abs">SUSE</div>
      <div id="prodname" class="abs" :style="{ fontSize: `${productPx}px`, top: `${197 - productPx / 2}px` }">{{ state.product_name }}</div>
      <div id="chapterViewport" class="abs" :style="viewportStyle">
        <div v-for="(title, i) in state.chapters" :key="i" class="abs pill" :class="{ on: active === i + 1 }"
          :style="pillStyle(i)">{{ title }}</div>
      </div>
      <div v-if="scrolling" id="chapterCounter" class="abs chapterIndicator"
        :style="indicatorStyle(220, CHAPTER_SCROLL.indicator_y, 300)">Chapter {{ active }} of {{ state.chapters.length }}</div>
      <div v-if="scrolling && offset > 1e-6" id="chaptersAbove" class="abs chapterIndicator" title="More chapters above"
        :style="indicatorStyle(CHAPTER_SCROLL.arrow_x, CHAPTER_SCROLL.arrow_top, 24)">^</div>
      <div v-if="scrolling && offset < state.chapters.length - count - 1e-6" id="chaptersBelow" class="abs chapterIndicator"
        title="More chapters below" :style="indicatorStyle(CHAPTER_SCROLL.arrow_x, CHAPTER_SCROLL.indicator_y, 24)">v</div>
      <div id="content" class="abs">your video here</div>
      <div id="bar" class="abs"><div id="hl" :style="headlineStyle"><AccentText :text="headline?.text ?? ''" /></div></div>
    </div>
  </div>
</template>
