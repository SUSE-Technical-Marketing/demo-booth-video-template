<script setup>
import { fmt } from '../timing.js';
import { THEMES } from '../themes.js';
import { DEFAULT_RESOLUTION, RESOLUTIONS } from '../project.js';

defineProps({
  title: { type: String, required: true },
  productName: { type: String, required: true },
  headlineEnd: { type: Number, default: null },
  wipeSeconds: { type: Number, required: true },
  cur: { type: Number, required: true },
  fps: { type: String, default: '25/1' },
  resolution: { type: String, default: DEFAULT_RESOLUTION },
  theme: { type: String, default: 'classic' },
});
const rippleBy = defineModel('rippleBy', { type: [Number, String], required: true });
const emit = defineEmits(['begin-edit', 'update-metadata', 'change-end', 'change-wipe', 'ripple', 'update-fps',
  'update-resolution', 'update-theme']);
const FPS_PRESETS = ['24/1', '24000/1001', '25/1', '30/1', '30000/1001', '50/1', '60/1', '60000/1001'];
</script>

<template>
  <section class="card">
    <h2>Video theme</h2>
    <label class="inline">Layout
      <select id="videoTheme" :value="theme" @change="emit('update-theme', $event.target.value)">
        <option v-for="(design, id) in THEMES" :key="id" :value="id">{{ design.label }}</option>
      </select>
    </label>
    <p class="hint">{{ THEMES[theme].description }} Used in the preview, fullscreen loop and rendered video.</p>
  </section>
  <section class="card">
    <h2>Video title and product</h2>
    <div id="meta" class="names">
      <label class="inline">title <input id="titleIn" :value="title" placeholder="Video title (for your own reference)"
        @focus="emit('begin-edit')" @input="emit('update-metadata', 'title', $event.target.value)"></label>
      <label class="inline">product <input id="productIn" :value="productName" placeholder="Shown under the logo"
        @focus="emit('begin-edit')" @input="emit('update-metadata', 'product_name', $event.target.value)"></label>
    </div>
  </section>
  <section class="card">
    <h2>Headline settings</h2>
    <div class="tools">
      <label class="inline">headlines end at <input id="endAt" :value="headlineEnd == null ? '' : fmt(headlineEnd)"
        size="7" placeholder="video end" @change="emit('change-end', $event)"></label>
      <label class="inline">wipe <input id="wipe" :value="wipeSeconds" type="number"
        min="0" max="3" step="0.1" @change="emit('change-wipe', $event)"> s</label>
    </div>
  </section>
  <section class="card">
    <h2>Render output</h2>
    <div class="tools">
      <label class="inline">Frame rate
        <select id="outputFPS" :value="fps" @change="emit('update-fps', $event.target.value); $event.target.value = fps">
          <option v-for="rate in FPS_PRESETS" :key="rate" :value="rate">{{ rate }} fps</option>
          <option v-if="!FPS_PRESETS.includes(fps)" :value="fps">{{ fps }} fps</option>
        </select>
      </label>
      <label class="inline">Resolution
        <select id="outputResolution" :value="resolution"
          @change="emit('update-resolution', $event.target.value); $event.target.value = resolution">
          <option v-for="[size, label] in RESOLUTIONS" :key="size" :value="size">{{ label }}</option>
          <option v-if="!RESOLUTIONS.some(([size]) => size === resolution)" :value="resolution">{{ resolution }}</option>
        </select>
      </label>
    </div>
    <p class="hint">The layout is composed at 1920 × 1080 and scaled to the chosen size by the renderer; the preview is
      not affected. Run the renderer with this project JSON to assemble all clips. Command-line options
      (<code>--fps</code>, <code>--size</code>) override these settings for one render.</p>
  </section>
  <section class="card">
    <h2>Ripple <span class="heading-hint">cut dead space? slide everything after the playhead</span></h2>
    <div class="tools ripple-tools">
      <span>Shift all chapters &amp; headlines at or after <b id="rippleAt">{{ fmt(cur) }}</b> by</span>
      <input id="rippleBy" v-model="rippleBy" type="number" step="0.5" aria-label="Ripple seconds"> s
      <button id="btnRipple" @click="emit('ripple')">Apply</button>
    </div>
  </section>
</template>
