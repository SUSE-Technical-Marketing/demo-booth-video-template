<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import AccentText from './AccentText.vue';
import { clipAt } from '../videos.js';
import { activeChapter, activeHeadline, chapterEnd, chapterScrollAt, chapterScrollSteps, duration, TEXT_SCALE } from '../timing.js';
import { themeLayout } from '../themes.js';
import localLogo from '../../../assets/SUSE_Logo-hor_Green.png';

const props = defineProps({
  state: { type: Object, required: true },
  cur: { type: Number, required: true },
  headlinePx: { type: Number, required: true },
  pillPx: { type: Number, required: true },
  productPx: { type: Number, required: true },
  clips: { type: Array, default: () => [] },
  playing: { type: Boolean, default: false },
  muted: { type: Boolean, default: false },
  presentation: { type: Boolean, default: false },
});
const emit = defineEmits(['playback-error', 'buffering']);
const view = ref(null), scale = ref(1), logoFailed = ref(false);
let observer;
onMounted(() => {
  observer = new ResizeObserver(() => { scale.value = view.value.clientWidth / 1920; });
  observer.observe(view.value);
  scale.value = view.value.clientWidth / 1920;
});
onUnmounted(() => observer?.disconnect());

// one <video> per clip; only the clip under the playhead is shown and played
const videos = new Map();
const clip = computed(() => clipAt(props.clips, props.cur));
const setVideo = (id, el) => { if (el) videos.set(id, el); else videos.delete(id); };
let previousTime = props.cur;
function mediaError(c, event) {
  const error = event.target.error;
  emit('playback-error', new Error(`Could not load ${c.name}: ${error?.message || 'video decoding failed'}`));
}
function waiting(c) {
  if (props.playing && clip.value?.id === c.id) emit('buffering', true);
}
function syncVideo() {
  const rewound = props.cur < previousTime;
  previousTime = props.cur;
  const current = clip.value;
  videos.forEach((el, id) => { if (id !== current?.id && !el.paused) el.pause(); });
  const el = current && videos.get(current.id);
  emit('buffering', !!el && props.playing && el.readyState < 3);
  if (!el) return;
  // a freeze frame shows one fixed frame of its video and never plays
  const frozen = !!current.freeze;
  const want = frozen ? current.source_in : (current.source_in ?? 0) + props.cur - current.start;
  const drift = Math.abs(el.currentTime - want);
  if (drift > 0.001 && (frozen || rewound || !props.playing || drift > 0.4)) el.currentTime = want;
  if (props.playing && !frozen && el.paused && !el.ended) el.play?.()?.catch?.(error => {
    if (props.playing && clip.value?.id === current.id && clip.value.url === current.url && videos.get(current.id) === el) {
      emit('playback-error', new Error(`Could not play ${current.name}: ${error.message}`));
    }
  });
  else if ((!props.playing || frozen) && !el.paused) el.pause();
}
watch([() => props.cur, () => props.playing, clip, () => props.clips.length], syncVideo, { flush: 'post' });
const themeId = computed(() => props.state.output?.theme ?? 'classic');
const design = computed(() => themeLayout(themeId.value));
const modern = computed(() => themeId.value !== 'classic');
const cinematic = computed(() => themeId.value === 'cinematic');
const horizontal = computed(() => design.value.CHAPTER_AXIS === 'horizontal');
watch(themeId, () => { logoFailed.value = false; });
const steps = computed(() => chapterScrollSteps(props.state, design.value.CHAPTER_SCROLL));
const offset = computed(() => chapterScrollAt(props.cur, steps.value, design.value.CHAPTER_SCROLL.seconds));
const active = computed(() => activeChapter(props.state, props.cur));
const headline = computed(() => activeHeadline(props.state, props.cur));
const scrolling = computed(() => props.state.chapters.length > design.value.CHAPTER_SCROLL.visible);
const count = computed(() => Math.min(props.state.chapters.length, design.value.CHAPTER_SCROLL.visible));
const chapterCenter = computed(() => design.value.CHAPTER_VIEW.cx - (count.value - 1) * design.value.PILL.pitch / 2);
const boxStyle = box => ({
  left: `${box.cx - box.w / 2}px`, top: `${box.cy - box.h / 2}px`,
  width: `${box.w}px`, height: `${box.h}px`, borderRadius: `${box.r}px`, borderWidth: `${box.line ?? 0}px`,
});
const logoStyle = computed(() => {
  const d = design.value, width = d.LOGO_W_PX * (modern.value ? 1125 / 880 : 1), height = width / 3;
  return { left: `${d.LOGO_CX - width / 2}px`, top: `${d.LOGO_CY - height / 2}px`,
    width: `${width}px`, height: `${height}px`, filter: modern.value ? 'brightness(0) invert(1)' : 'invert(1) hue-rotate(180deg)' };
});
const productStyle = computed(() => {
  const d = design.value;
  return { left: `${d.PRODUCT_CX - d.PRODUCT_MAX_W / 2}px`, width: `${d.PRODUCT_MAX_W}px`,
    top: `${d.PRODUCT_CY - props.productPx / 2}px`, fontSize: `${props.productPx}px`, color: d.BRAND.product,
    textAlign: cinematic.value ? 'right' : 'center' };
});
const progress = computed(() => {
  const chapter = props.state.chapter_starts.find(c => c.ch === active.value);
  const end = chapterEnd(props.state, chapter, props.state.preview_end ?? duration(props.state));
  return Math.max(0, Math.min(1, (props.cur - chapter.t) / Math.max(0.001, end - chapter.t)));
});
function fadeStyle(fade) {
  const color = design.value.BRAND.canvas, alpha = value => value.toString(16).padStart(2, '0');
  return { left: 0, top: `${fade.y}px`, width: '1920px', height: `${fade.h}px`,
    background: `linear-gradient(${color}${alpha(fade.from)}, ${color}${alpha(fade.to)})` };
}
function pillStyle(i) {
  const d = design.value, pill = d.PILL, view = d.CHAPTER_VIEW, on = active.value === i + 1;
  const rows = modern.value ? d.CHAPTER_SCROLL.visible : count.value;
  const cx = horizontal.value ? chapterCenter.value + (i - offset.value) * pill.pitch : pill.cx;
  const cy = pill.cy_last - (horizontal.value ? 0 : (rows - i - 1 + offset.value) * pill.pitch);
  return { ...boxStyle({ ...pill, cx, cy }),
    left: `${cx - pill.w / 2 - (view.cx - view.w / 2)}px`,
    top: `${cy - pill.h / 2 - (view.cy - view.h / 2)}px`,
    fontSize: `${props.pillPx}px`, background: on ? d.BRAND.pill_active : d.BRAND.pill_base,
    color: modern.value && on ? d.BRAND.headline : d.BRAND.pill_text, borderColor: d.BRAND.pill_line,
    paddingLeft: modern.value ? `${d.PILL_TEXT_PAD}px` : 0,
    paddingRight: modern.value ? '16px' : 0 };
}
function indicatorStyle(x, y, width) {
  const px = design.value.CHAPTER_SCROLL.indicator_px * TEXT_SCALE;
  return { left: `${x - width / 2}px`, top: `${y - px / 2}px`,
    width: `${width}px`, fontSize: `${px}px`, color: design.value.BRAND.product };
}
const headlineStyle = computed(() => {
  const progress = headline.value ? Math.max(0, Math.min(1, (props.cur - headline.value.t) / Math.max(0.01, props.state.wipe_seconds))) : 1;
  return { fontSize: `${props.headlinePx}px`, clipPath: `inset(-20px ${(1 - progress) * 100}% -20px -12px)` };
});
</script>

<template>
  <div id="view" ref="view">
    <div id="stage" :data-theme="themeId" :style="{ transform: `scale(${scale})`, background: design.BRAND.canvas,
      '--theme-accent': design.BRAND.accent, '--theme-headline': design.BRAND.headline,
      '--chapter-number-px': `${design.CHAPTER_SCROLL.indicator_px * TEXT_SCALE}px` }">
      <div id="content" class="abs" :style="{ ...boxStyle(design.CONTENT), background: clips.length && !clip ? '#000' : design.BRAND.content_bg }">
        <video v-for="c in clips.filter(c => c.url)" v-show="clip?.id === c.id" :key="c.id" :ref="el => setVideo(c.id, el)" :src="c.url"
          :muted="muted" playsinline preload="auto" @waiting="waiting(c)" @canplay="syncVideo"
          @playing="syncVideo" @seeked="syncVideo" @error="mediaError(c, $event)"></video>
        <span v-if="!clips.length">your video here</span>
        <span v-else-if="!clip && !presentation" class="gap">no video at this time</span>
        <span v-else-if="clip && !clip.url" class="gap">Missing media: {{ clip.name }}. Relink in Videos &amp; settings.</span>
      </div>
      <div v-for="(fade, i) in design.FADES ?? []" :key="i" class="abs video-fade" :style="fadeStyle(fade)"></div>
      <div v-if="!cinematic && !horizontal" id="panel" class="abs" :style="{ ...boxStyle(design.PANEL), background: design.BRAND.panel }"></div>
      <img v-if="!logoFailed" id="logo" class="abs" :style="logoStyle"
        :src="modern ? localLogo : 'https://www.suse.com/assets/img/suse-white-logo-green.svg'" alt="SUSE" @error="logoFailed = true">
      <div v-else id="logoFallback" class="abs" :style="{ left: `${design.LOGO_CX - design.LOGO_W_PX / 2}px`,
        top: `${design.LOGO_CY - design.LOGO_W_PX / 6}px`, width: `${design.LOGO_W_PX}px`, fontSize: `${design.LOGO_W_PX / 3.375}px` }">SUSE</div>
      <div id="prodname" class="abs" :style="productStyle">{{ state.product_name }}</div>
      <div v-if="!cinematic" id="chapterViewport" class="abs" :style="boxStyle(design.CHAPTER_VIEW)">
        <div v-for="(title, i) in state.chapters" :key="i" class="abs pill" :class="{ on: active === i + 1 }"
          :data-number="String(i + 1).padStart(2, '0')" :style="pillStyle(i)">{{ title }}
          <div v-if="horizontal && active === i + 1" id="chapterProgress" class="abs chapter-progress" aria-hidden="true"
            :style="{ height: `${design.PROGRESS.h}px`, background: design.BRAND.pill_active }">
            <span :style="{ width: `${progress * 100}%`, background: design.BRAND.accent }"></span>
          </div>
        </div>
      </div>
      <div v-if="!cinematic && (scrolling || modern)" id="chapterCounter" class="abs chapterIndicator"
        :style="indicatorStyle(design.CHAPTER_VIEW.cx, design.CHAPTER_SCROLL.indicator_y, modern ? 240 : 300)">Chapter {{ active }} of {{ state.chapters.length }}</div>
      <div v-if="!cinematic && scrolling && offset > 1e-6" id="chaptersAbove" class="abs chapterIndicator"
        :title="horizontal ? 'More chapters to the left' : 'More chapters above'"
        :style="indicatorStyle(design.CHAPTER_SCROLL.arrow_x, design.CHAPTER_SCROLL.arrow_top, 24)">{{ horizontal ? '<' : '^' }}</div>
      <div v-if="!cinematic && scrolling && offset < state.chapters.length - count - 1e-6" id="chaptersBelow" class="abs chapterIndicator"
        :title="horizontal ? 'More chapters to the right' : 'More chapters below'"
        :style="indicatorStyle(horizontal ? design.CHAPTER_SCROLL.arrow_end_x : design.CHAPTER_SCROLL.arrow_x,
          horizontal ? design.CHAPTER_SCROLL.arrow_top : design.CHAPTER_SCROLL.indicator_y, 24)">{{ horizontal ? '>' : 'v' }}</div>
      <div v-if="cinematic" id="currentChapter" class="abs current-chapter"
        :style="{ ...boxStyle(design.CHAPTER_VIEW), fontSize: `${pillPx}px` }">
        <span class="chapter-sequence" :style="{ width: `${design.PILL_TEXT_PAD}px` }">{{ String(active).padStart(2, '0') }} / {{ String(state.chapters.length).padStart(2, '0') }}</span>
        <span>{{ state.chapters[active - 1] }}</span>
      </div>
      <div id="bar" class="abs" :style="{ ...boxStyle(design.BAR), background: cinematic ? 'transparent' : design.BRAND.bar_fill,
        borderColor: design.BRAND.bar_line, justifyContent: 'center' }">
        <div id="hl" :style="headlineStyle"><AccentText :text="headline?.text ?? ''" /></div>
      </div>
      <div v-if="design.PROGRESS && !horizontal" id="chapterProgress" class="abs chapter-progress" aria-hidden="true"
        :style="{ ...boxStyle(design.PROGRESS), background: design.BRAND.pill_active }">
        <span :style="{ width: `${progress * 100}%`, background: design.BRAND.accent }"></span>
      </div>
    </div>
  </div>
</template>
