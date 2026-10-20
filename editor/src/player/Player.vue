<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Preview from '../components/Preview.vue';
import PlayerTimeline from './PlayerTimeline.vue';
import { layoutFit } from '../layoutFit.js';
import { activeChapter, duration as timingDuration } from '../timing.js';
import { themeLayout } from '../themes.js';

const props = defineProps({
  state: { type: Object, required: true },
  video: { type: String, default: '' },           // the footage file next to this page
  title: { type: String, default: '' },
});

const cur = ref(0), playing = ref(false), started = ref(false), muted = ref(false), buffering = ref(false);
const length = ref(0), failure = ref(''), fullscreen = ref(false), fontsVersion = ref(0);
const preview = ref(null), root = ref(null), surface = ref(null);
let frame = 0, resumeAfterScrub = false, hold = null;

const design = computed(() => themeLayout(props.state.output.theme));
const hasVideo = computed(() => length.value > 0);
const total = computed(() => length.value || timingDuration(props.state));
const clips = computed(() => hasVideo.value ? [{ id: 'footage', name: props.video, url: props.video, start: 0, dur: length.value,
  source_in: 0, source_out: length.value }] : []);
const previewState = computed(() => ({ ...props.state, preview_end: total.value }));

const context = document.createElement('canvas').getContext('2d');
function measure(text, px) {
  fontsVersion.value;
  context.font = `500 ${px}px SUSE, system-ui, sans-serif`;
  return context.measureText(text).width;
}
const fit = computed(() => layoutFit(props.state, measure));

// The video keeps the clock while it plays; seeking sets the time and the preview moves the video to it.
function tick() {
  if (!playing.value) return;
  const media = preview.value?.mediaState();
  if (media && !media.seeking) {
    if (media.ended || media.time >= total.value - 0.03) return finish();
    // right after a jump the video can report a hair before the target, which would flash the previous chapter
    cur.value = hold && performance.now() < hold.until && media.time < hold.time ? hold.time : Math.max(0, media.time);
  }
  frame = requestAnimationFrame(tick);
}
function play() {
  if (!hasVideo.value) return;
  if (cur.value >= total.value - 0.1) seek(0);
  started.value = true;
  playing.value = true;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(tick);
}
function pause() {
  playing.value = false;
  cancelAnimationFrame(frame);
}
function finish() {
  pause();
  cur.value = Math.max(0, total.value - 0.04);          // stay on the last picture
}
const toggle = () => playing.value ? pause() : play();
function seek(time) {
  const t = Math.max(0, Math.min(total.value - 0.04, time));
  hold = { time: t, until: performance.now() + 600 };
  cur.value = t;
}
function jump(time) {
  seek(time);
  play();
}
const starts = computed(() => props.state.chapter_starts.slice().sort((a, b) => a.t - b.t));
function selectChapter(ch) {
  jump(props.state.chapter_starts.find(c => c.ch === ch).t);
}
function nextChapter(direction) {
  const here = starts.value.findLastIndex(c => c.t <= cur.value + 1e-6);
  // going back restarts the chapter first, and only a second press steps to the one before
  const target = direction > 0 ? here + 1 : (cur.value - starts.value[here]?.t > 2 ? here : here - 1);
  const chapter = starts.value[Math.max(0, Math.min(starts.value.length - 1, target))];
  if (chapter) jump(chapter.t);
}
function scrub(time) {
  if (playing.value) { resumeAfterScrub = true; pause(); }
  seek(time);
}
function commit(time) {
  resumeAfterScrub = false;
  jump(time);
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else root.value.requestFullscreen?.().catch(() => {});
}
function keydown(event) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
  const interactive = event.target.closest?.('button, [role=button]');
  const key = event.key;
  if (key === ' ' || key === 'k') {
    if (interactive && key === ' ') return;                // a focused button presses itself
    event.preventDefault();
    toggle();
  } else if (key === 'ArrowRight' || key === 'ArrowLeft') {
    event.preventDefault();
    const step = (event.shiftKey ? 15 : 5) * (key === 'ArrowRight' ? 1 : -1);
    seek(cur.value + step);
  } else if (key === 'PageDown' || key === 'n') nextChapter(1);
  else if (key === 'PageUp' || key === 'p') nextChapter(-1);
  else if (key === 'Home') seek(0);
  else if (key === 'End') seek(total.value);
  else if (key === 'm') muted.value = !muted.value;
  else if (key === 'f') toggleFullscreen();
}
const fullscreenChanged = () => { fullscreen.value = document.fullscreenElement === root.value; };

const surfaceStyle = computed(() => {
  const box = design.value.CONTENT;
  return { left: `${(box.cx - box.w / 2) / 19.2}%`, top: `${(box.cy - box.h / 2) / 10.8}%`,
    width: `${box.w / 19.2}%`, height: `${box.h / 10.8}%`, borderRadius: `${box.r / 19.2}%` };
});
const clock = t => {
  const s = Math.max(0, Math.floor(t + 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const chapterTitle = computed(() => props.state.chapters[activeChapter(props.state, cur.value) - 1]);

onMounted(() => {
  document.addEventListener('keydown', keydown);
  document.addEventListener('fullscreenchange', fullscreenChanged);
  document.fonts?.load('500 20px SUSE').then(() => { fontsVersion.value++; }).catch(() => {});
  if (!props.video) return;
  // learn the length without waiting for the picture; also catches a missing file with a plain message
  const probe = document.createElement('video');
  probe.preload = 'metadata';
  probe.onloadedmetadata = () => { length.value = probe.duration; };
  probe.onerror = () => {
    failure.value = `Could not load ${props.video}. Keep it in the same folder as this page, and open the page from the unzipped folder.`;
  };
  probe.src = props.video;
});
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  document.removeEventListener('keydown', keydown);
  document.removeEventListener('fullscreenchange', fullscreenChanged);
});
watch(playing, value => { if (value) failure.value = ''; });
defineExpose({ cur, playing, seek, jump, selectChapter, nextChapter, toggle });
</script>

<template>
  <div ref="root" class="player" :data-theme="state.output.theme">
    <div class="preview-canvas player-canvas">
      <div class="player-stage">
        <Preview ref="preview" :state="previewState" :cur="cur" :headline-px="fit.headline.px" :pill-px="fit.pillPx"
          :product-px="fit.productPx" :clips="clips" :playing="playing" :muted="muted" presentation interactive offline settled
          @select-chapter="selectChapter" @buffering="buffering = $event"
          @playback-error="failure = $event.message" />
        <button v-if="hasVideo" ref="surface" class="player-surface" :style="surfaceStyle" type="button"
          :aria-label="playing ? 'Pause' : 'Play'" @click="toggle">
          <span v-if="!playing && !buffering" class="player-big-play" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
        </button>
        <div v-if="buffering && playing" class="player-spinner" :style="{ left: `calc(${design.CONTENT.cx / 19.2}% - 22px)`, top: `calc(${design.CONTENT.cy / 10.8}% - 22px)` }"
          role="status" aria-label="Loading"></div>
        <p v-if="failure" class="player-note" role="alert">{{ failure }}</p>
        <p v-else-if="!video" class="player-note" role="status">No video in this page yet: this is the sample layout.</p>
      </div>
    </div>
    <div class="player-bar">
      <div class="player-controls" role="toolbar" aria-label="Playback">
        <button class="player-play" type="button" :disabled="!hasVideo" :aria-label="playing ? 'Pause' : 'Play'" @click="toggle">
          <svg v-if="playing" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
        <button type="button" title="Previous chapter (P)" aria-label="Previous chapter" :disabled="!hasVideo" @click="nextChapter(-1)">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 6h2v12H6zM9.5 12 18 18V6z"/></svg></button>
        <button type="button" title="Next chapter (N)" aria-label="Next chapter" :disabled="!hasVideo" @click="nextChapter(1)">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg></button>
        <span class="player-time">{{ clock(cur) }} / {{ clock(total) }}</span>
        <span class="player-title">{{ chapterTitle }}</span>
        <button type="button" :aria-pressed="muted" :title="muted ? 'Sound off (M)' : 'Sound on (M)'" :aria-label="muted ? 'Turn sound on' : 'Turn sound off'"
          @click="muted = !muted">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9z"/>
            <path v-if="!muted" d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path v-else d="m15 9 6 6m0-6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        <button type="button" title="Fullscreen (F)" :aria-pressed="fullscreen" aria-label="Fullscreen" @click="toggleFullscreen">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 4h6v2H6v4H4zM20 4v6h-2V6h-4V4zM4 20v-6h2v4h4v2zM20 20h-6v-2h4v-4h2z"/></svg></button>
      </div>
      <PlayerTimeline :state="previewState" :total="total" :cur="cur" :nested="!!design.SUBCHAPTERS" @scrub="scrub" @commit="commit" />
    </div>
  </div>
</template>
