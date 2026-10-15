<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import Preview from './Preview.vue';

const props = defineProps({
  state: { type: Object, required: true },
  cur: { type: Number, required: true },
  headlinePx: { type: Number, required: true },
  pillPx: { type: Number, required: true },
  productPx: { type: Number, required: true },
  clips: { type: Array, default: () => [] },
  playing: { type: Boolean, default: false },
});
const emit = defineEmits(['present', 'toggle-play', 'playback-error', 'buffering']);
const canvas = ref(null), presenting = ref(false), entering = ref(false), muted = ref(true);
const controlsVisible = ref(true), failure = ref('');
const unavailable = computed(() => !props.clips.length ? 'Add videos before starting a fullscreen loop.'
  : props.clips.some(clip => !clip.url) ? 'Relink all missing videos before starting a fullscreen loop.' : '');
let controlsTimer, disposed = false;
watch(() => props.playing, playing => { if (playing) failure.value = ''; });
function revealControls() {
  controlsVisible.value = true;
  clearTimeout(controlsTimer);
  if (presenting.value) controlsTimer = setTimeout(() => { controlsVisible.value = false; }, 3000);
}
function fullscreenChanged() {
  const active = document.fullscreenElement === canvas.value;
  if (active === presenting.value) return;
  presenting.value = active;
  if (active) {
    muted.value = true;
    failure.value = '';
    revealControls();
    nextTick(() => canvas.value?.focus());
  } else {
    clearTimeout(controlsTimer);
    controlsVisible.value = true;
  }
  emit('present', active);
}
async function enterFullscreen() {
  if (entering.value) return;
  failure.value = '';
  if (unavailable.value) {
    failure.value = unavailable.value;
    return;
  }
  if (!canvas.value.requestFullscreen) {
    failure.value = 'Fullscreen is not supported here. Open the editor in a browser that supports fullscreen.';
    return;
  }
  entering.value = true;
  try {
    await canvas.value.requestFullscreen();
    if (!disposed) fullscreenChanged();
  } catch (error) {
    if (!disposed) failure.value = `Could not enter fullscreen: ${error.message}`;
  } finally {
    entering.value = false;
  }
}
async function exitFullscreen() {
  try {
    await document.exitFullscreen();
    if (!disposed) fullscreenChanged();
  } catch (error) {
    if (!disposed) failure.value = `Could not exit fullscreen: ${error.message}. Press Escape to exit.`;
  }
}
function playbackError(error) {
  failure.value = error.message;
  revealControls();
  emit('playback-error', error);
}
defineExpose({ enterFullscreen, entering, unavailable });
onMounted(() => document.addEventListener('fullscreenchange', fullscreenChanged));
onUnmounted(() => {
  disposed = true;
  clearTimeout(controlsTimer);
  document.removeEventListener('fullscreenchange', fullscreenChanged);
});
</script>

<template>
  <div class="preview-heading">
    <h2>Preview</h2>
    <span class="chip">1920 × 1080</span>
  </div>
  <div ref="canvas" class="preview-canvas" :class="{ 'controls-hidden': presenting && playing && !controlsVisible && !failure }"
    tabindex="-1" @pointermove="revealControls" @pointerdown="revealControls" @keydown="revealControls">
    <Preview :state="state" :cur="cur" :headline-px="headlinePx" :pill-px="pillPx" :product-px="productPx"
      :clips="clips" :playing="playing" :muted="presenting && muted" :presentation="presenting"
      @playback-error="playbackError" @buffering="emit('buffering', $event)" />
    <p v-if="failure" class="playback-error" role="alert">{{ failure }}</p>
    <div v-if="presenting" class="presentation-controls" role="toolbar" aria-label="Fullscreen playback" @focusin="revealControls">
      <span>Looping</span>
      <button aria-label="Pause or resume fullscreen playback" @click="emit('toggle-play')">{{ playing ? 'Pause' : 'Play' }}</button>
      <button :aria-pressed="!muted" @click="muted = !muted">{{ muted ? 'Enable audio' : 'Mute audio' }}</button>
      <button @click="exitFullscreen">Exit fullscreen</button>
      <span class="hint">Space: play/pause · Esc: exit</span>
    </div>
  </div>
</template>
