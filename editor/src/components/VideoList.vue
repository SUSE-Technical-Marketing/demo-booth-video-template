<script setup>
import { ref } from 'vue';
import { chaptersCovered } from '../videos.js';
import { fmt, parseClock } from '../timing.js';

const props = defineProps({
  clips: { type: Array, required: true },
  switches: { type: Array, required: true },
});
const emit = defineEmits(['add', 'update-start', 'remove', 'error']);
const input = ref(null);
function add(event) {
  const files = [...event.target.files];
  event.target.value = '';
  if (files.length) emit('add', files);
}
function commitStart(clip, event) {
  const time = parseClock(event.target.value);
  if (!Number.isFinite(time)) {
    event.target.value = fmt(clip.start);
    return emit('error', 'Enter a valid start time, such as 3:44');
  }
  emit('update-start', clip, time);
}
function snap(clip, event) {
  const target = props.switches.find(s => s.id === +event.target.value);
  event.target.value = '';
  if (target) emit('update-start', clip, target.t);
}
</script>

<template>
  <section class="card">
    <h2>Videos <span v-if="clips.length" id="vidChip" class="chip">{{ clips.length }} loaded</span></h2>
    <div id="vlist">
      <div v-for="clip in clips" :key="clip.id" class="vrow">
        <div class="name" :title="clip.name">{{ clip.name }}</div>
        <span class="meta">{{ fmt(clip.dur) }}<template v-if="chaptersCovered(clip, switches).length"> · ch {{ chaptersCovered(clip, switches).join(', ') }}</template></span>
        <input class="time" :value="fmt(clip.start)" aria-label="Video start time" title="Where this video starts on the timeline (m:ss)"
          @focus="$event.target.select()" @change="commitStart(clip, $event)" @keydown.enter="$event.target.blur()">
        <select aria-label="Snap to chapter" title="Start at the beginning of a chapter" @change="snap(clip, $event)">
          <option value="">snap…</option>
          <option v-for="s in switches" :key="s.id" :value="s.id">ch {{ s.ch }} · {{ fmt(s.t) }}</option>
        </select>
        <button class="icon ghost" title="Remove this video" @click="emit('remove', clip)">✕</button>
      </div>
    </div>
    <div class="tools">
      <button id="btnVideo" title="Preview videos stay on your computer, nothing is uploaded" @click="input.click()">Add videos…</button>
      <input id="videoFile" ref="input" type="file" accept="video/*" multiple hidden @change="add">
    </div>
    <p class="hint">Add one video per chapter, or one that covers several. Each plays from the time you set; <b>snap</b> moves it
      to the start of a chapter. Preview only: the renderer still takes a single video.</p>
  </section>
</template>
