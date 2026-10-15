<script setup>
import { ref } from 'vue';
import { chaptersCovered } from '../videos.js';
import { fmt, parseClock } from '../timing.js';

const props = defineProps({
  clips: { type: Array, required: true },
  starts: { type: Array, required: true },
  mediaFolder: { type: String, default: '' },
});
const emit = defineEmits(['add', 'update-folder', 'update-start', 'update-clip', 'update-path', 'relink', 'remove', 'error']);
const input = ref(null), relinkInput = ref(null), relinking = ref(null);
function add(event) {
  const files = [...event.target.files];
  event.target.value = '';
  if (files.length) emit('add', files);
}
function commitStart(clip, event) {
  const time = parseClock(event.target.value);
  event.target.value = fmt(clip.start);
  if (!Number.isFinite(time)) {
    event.target.value = fmt(clip.start);
    return emit('error', 'Enter a valid start time, such as 3:44');
  }
  emit('update-start', clip, time);
}
function commitTrim(clip, key, event) {
  const time = parseClock(event.target.value);
  event.target.value = fmt(clip[key]);
  if (!Number.isFinite(time)) return emit('error', 'Enter a valid source time');
  emit('update-clip', clip, { [key]: time });
}
function commitPath(clip, event) {
  const path = event.target.value.trim();
  event.target.value = clip.path;
  emit('update-path', clip, path);
}
function commitFolder(event) {
  const folder = event.target.value.trim();
  event.target.value = props.mediaFolder;
  emit('update-folder', folder);
}
function relink(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) emit('relink', relinking.value, file);
}
function snap(clip, event) {
  const target = props.starts.find(s => s.id === +event.target.value);
  event.target.value = '';
  if (target) emit('update-start', clip, target.t);
}
</script>

<template>
  <section class="card">
    <h2>Videos <span v-if="clips.length" id="vidChip" class="chip">{{ clips.length }} loaded</span></h2>
    <label class="clip-path media-folder">Media folder
      <input id="mediaFolder" :value="mediaFolder" placeholder="e.g. media" aria-describedby="mediaFolderHint"
        @change="commitFolder" @keydown.enter="$event.target.blur()">
    </label>
    <p id="mediaFolderHint" class="hint">Relative to the project JSON; leave blank for the JSON's folder.
      Applied automatically to every media path below. Changing it updates all references, without moving files.</p>
    <div id="vlist">
      <div v-for="clip in clips" :key="clip.id" class="vrow">
        <div class="name" :title="clip.name">{{ clip.name }}</div>
        <span class="meta">{{ fmt(clip.dur) }} · {{ clip.url ? 'linked' : 'missing media' }}<template v-if="chaptersCovered(clip, starts).length"> · ch {{ chaptersCovered(clip, starts).join(', ') }}</template></span>
        <input class="time" :value="fmt(clip.start)" aria-label="Video start time" title="Where this video starts on the timeline (m:ss)"
          @focus="$event.target.select()" @change="commitStart(clip, $event)" @keydown.enter="$event.target.blur()">
        <select aria-label="Snap to chapter" title="Start at the beginning of a chapter" @change="snap(clip, $event)">
          <option value="">snap…</option>
          <option v-for="s in starts" :key="s.id" :value="s.id">ch {{ s.ch }} · {{ fmt(s.t) }}</option>
        </select>
        <button class="icon ghost" title="Remove this video" @click="emit('remove', clip)">✕</button>
        <div class="clip-source">
          <label>In <input class="time" :value="fmt(clip.source_in)" aria-label="Source in"
            @change="commitTrim(clip, 'source_in', $event)"></label>
          <label>Out <input class="time" :value="fmt(clip.source_out)" aria-label="Source out"
            @change="commitTrim(clip, 'source_out', $event)"></label>
        </div>
        <label class="clip-path">Media path <input :value="clip.path" aria-label="Media path"
          title="Relative to the media folder, using forward slashes" @change="commitPath(clip, $event)">
          <span class="hint resolved-media-path">Project path: {{ clip.resolvedPath }}</span>
        </label>
        <button class="relink-media" @click="relinking = clip; relinkInput.click()">Relink media…</button>
      </div>
    </div>
    <div class="tools">
      <button id="btnVideo" title="Preview videos stay on your computer, nothing is uploaded" @click="input.click()">Add videos…</button>
      <input id="videoFile" ref="input" type="file" accept="video/*" multiple hidden @change="add">
      <input id="relinkFile" ref="relinkInput" type="file" accept="video/*" hidden @change="relink">
    </div>
    <p class="hint">Add one video per chapter, or one that covers several. Each plays from the time you set; <b>snap</b> moves it
      to the start of a chapter. Placements, source trims and relative media paths are saved in the project.
      Hard cuts only: overlapping clips are rejected. Gaps render black with silence.
      Use <b>Open project folder…</b> to link videos automatically, or <b>Relink media…</b> when opening only the JSON.</p>
  </section>
</template>
