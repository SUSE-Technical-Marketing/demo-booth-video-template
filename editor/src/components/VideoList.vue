<script setup>
import { computed, nextTick, ref } from 'vue';
import { chaptersCovered } from '../videos.js';
import { fmt, parseClock } from '../timing.js';

const props = defineProps({
  clips: { type: Array, required: true },
  starts: { type: Array, required: true },
  mediaFolder: { type: String, default: '' },
  linkMedia: { type: Function, required: true },
});
const emit = defineEmits(['add', 'update-folder', 'update-start', 'update-clip', 'remove', 'update-freeze', 'update-dissolve', 'reorder', 'error']);
const input = ref(null), relinkInput = ref(null), relinking = ref(null);
const relinkPopover = ref(null), relinkButton = ref(null), relinkOpen = ref(false);
const showLinked = ref(false), linking = ref(false), linkError = ref('');
const mediaLinks = computed(() => {
  const media = new Map();
  for (const [index, clip] of props.clips.entries()) {
    const key = clip.media_id ?? clip.id;
    if (!media.has(key)) media.set(key, { clip, uses: [], missing: false });
    const entry = media.get(key);
    entry.uses.push(index + 1);
    entry.missing ||= !clip.url || (clip.sourceDuration != null &&
      (clip.freeze ? clip.source_in : clip.source_out) > clip.sourceDuration + 1e-6);
  }
  return [...media.values()];
});
const missingCount = computed(() => mediaLinks.value.filter(entry => entry.missing).length);
const visibleLinks = computed(() => mediaLinks.value.filter(entry => showLinked.value || entry.missing));
function showRelink() {
  showLinked.value = false;
  linkError.value = '';
  try { relinkPopover.value.showPopover(); }
  catch (error) { emit('error', `Could not open media relinking: ${error.message}`); }
}
function closeRelink() {
  relinkPopover.value.hidePopover();
  relinkButton.value.focus();
}
function chooseMedia(clip) {
  relinking.value = clip;
  relinkInput.value.click();
}
const draggingId = ref(null), dropIndex = ref(null);
function dragStart(clip, event) {
  draggingId.value = clip.id;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', clip.id);
}
function clearDrag() {
  draggingId.value = null;
  dropIndex.value = null;
}
function dragOver(index, event) {
  if (draggingId.value === null) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const rect = event.currentTarget.getBoundingClientRect();
  dropIndex.value = index + (event.clientY >= rect.top + rect.height / 2 ? 1 : 0);
}
function drop(event) {
  if (draggingId.value === null || dropIndex.value === null) return;
  event.preventDefault();
  emit('reorder', draggingId.value, props.clips[dropIndex.value]?.id ?? null);
  clearDrag();
}
function move(index, direction) {
  emit('reorder', props.clips[index].id, props.clips[direction < 0 ? index - 1 : index + 2]?.id ?? null);
}
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
function commitFrame(clip, event) {                 // which frame a freeze holds; its length stays the same
  const time = parseClock(event.target.value);
  event.target.value = fmt(clip.source_in);
  if (!Number.isFinite(time)) return emit('error', 'Enter a valid source time');
  emit('update-clip', clip, { source_in: time, source_out: time + clip.dur });
}
function commitLength(clip, event) {
  const seconds = parseClock(event.target.value.trim());
  event.target.value = fmt(clip.dur);
  if (!Number.isFinite(seconds)) return emit('error', 'Enter a length in seconds, such as 3 or 0:03.5');
  emit('update-freeze', clip, seconds);
}
function commitFolder(event) {
  const folder = event.target.value.trim();
  event.target.value = props.mediaFolder;
  emit('update-folder', folder);
}
function commitDissolve(clip, event) {
  const raw = event.target.value.trim(), seconds = raw === '' ? NaN : Number(raw);
  event.target.value = clip.transition_in?.duration ?? 0;
  if (!Number.isFinite(seconds) || seconds < 0) return emit('error', 'Enter a non-negative dissolve duration in seconds');
  emit('update-dissolve', clip, seconds);
}
function commitTransition(clip, index, event) {
  const seconds = event.target.value === 'cut' ? 0 : Math.min(0.5, clip.dur / 4, props.clips[index - 1].dur / 4);
  event.target.value = clip.transition_in ? 'crossfade' : 'cut';
  emit('update-dissolve', clip, seconds);
}
async function relink(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  linking.value = true;
  linkError.value = '';
  try {
    await props.linkMedia(relinking.value, file);
  } catch (error) {
    linkError.value = error.message;
    emit('error', error.message);
  } finally {
    linking.value = false;
    await nextTick();
    if (relinkOpen.value) relinkPopover.value?.querySelector('.relink-item button:not(:disabled), .relink-close')?.focus();
  }
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
    <p v-if="clips.length > 1" class="hint">Drag the grip on the left edge of a clip to insert it before or after another clip,
      or use Move up / Move down. Reordering closes gaps and starts at zero; chapter and headline times stay unchanged.
      Incompatible dissolves become hard cuts with a notification.</p>
    <div id="vlist" @dragleave="!$event.currentTarget.contains($event.relatedTarget) && (dropIndex = null)">
      <div v-for="(clip, index) in clips" :key="clip.id" class="vrow" :data-clip-id="clip.id"
        :class="{ freeze: clip.freeze, reorderable: clips.length > 1, dragging: draggingId === clip.id,
          'drop-before': dropIndex === index, 'drop-after': index === clips.length - 1 && dropIndex === clips.length }"
        @dragover="dragOver(index, $event)" @drop="drop">
        <div class="name" :title="clip.name">{{ clip.freeze ? 'Freeze frame' : clip.name }}</div>
        <span v-if="clip.freeze" class="meta">of {{ clip.name }} · held {{ fmt(clip.dur) }}</span>
        <span v-else class="meta">{{ fmt(clip.dur) }} · {{ clip.url ? 'linked' : 'missing media' }}<template v-if="chaptersCovered(clip, starts).length"> · ch {{ chaptersCovered(clip, starts).join(', ') }}</template></span>
        <input class="time" :value="fmt(clip.start)" aria-label="Video start time" title="Where this video starts on the timeline (m:ss)"
          @focus="$event.target.select()" @change="commitStart(clip, $event)" @keydown.enter="$event.target.blur()">
        <select aria-label="Snap to chapter" title="Start at the beginning of a chapter" @change="snap(clip, $event)">
          <option value="">snap…</option>
          <option v-for="s in starts" :key="s.id" :value="s.id">ch {{ s.ch }} · {{ fmt(s.t) }}</option>
        </select>
        <button class="icon ghost" title="Remove this video" @click="emit('remove', clip)">✕</button>
        <div v-if="clips.length > 1" class="clip-order" role="group" :aria-label="`Reorder clip ${index + 1}: ${clip.name}`">
          <button class="clip-drag ghost" draggable="true" :aria-label="`Drag to reorder clip ${index + 1}: ${clip.name}`"
            title="Drag to insert this clip before or after another clip; or use Move up / Move down"
            @dragstart="dragStart(clip, $event)" @dragend="clearDrag">
            <svg width="12" height="24" viewBox="0 0 12 24" aria-hidden="true" focusable="false">
              <circle cx="3" cy="6" r="1.5" /><circle cx="9" cy="6" r="1.5" />
              <circle cx="3" cy="12" r="1.5" /><circle cx="9" cy="12" r="1.5" />
              <circle cx="3" cy="18" r="1.5" /><circle cx="9" cy="18" r="1.5" />
            </svg>
          </button>
          <button class="ghost" :aria-label="`Move clip ${index + 1} up`" :disabled="index === 0"
            @click="move(index, -1)">Move up</button>
          <button class="ghost" :aria-label="`Move clip ${index + 1} down`" :disabled="index === clips.length - 1"
            @click="move(index, 1)">Move down</button>
        </div>
        <div v-if="clip.freeze" class="clip-source">
          <label>Frame at <input class="time" :value="fmt(clip.source_in)" aria-label="Frozen frame at"
            title="Which moment of the source video is held" @change="commitFrame(clip, $event)"></label>
          <label>Length <input class="time" :value="fmt(clip.dur)" aria-label="Freeze length"
            title="How long the frame is held. Everything after it moves with it." @change="commitLength(clip, $event)"></label>
        </div>
        <div v-else class="clip-source">
          <label>In <input class="time" :value="fmt(clip.source_in)" aria-label="Source in"
            @change="commitTrim(clip, 'source_in', $event)"></label>
          <label>Out <input class="time" :value="fmt(clip.source_out)" aria-label="Source out"
            @change="commitTrim(clip, 'source_out', $event)"></label>
        </div>
        <div v-if="index" class="clip-source dissolve-controls">
          <label>Transition in
            <select aria-label="Transition in" :value="clip.transition_in ? 'crossfade' : 'cut'"
              @change="commitTransition(clip, index, $event)">
              <option value="cut">Hard cut</option>
              <option value="crossfade">Cross-dissolve</option>
            </select>
          </label>
          <label v-if="clip.transition_in">Seconds
            <input class="time" :value="clip.transition_in.duration" aria-label="Dissolve duration"
              inputmode="decimal" @change="commitDissolve(clip, $event)" @keydown.enter="$event.target.blur()">
          </label>
          <span class="hint">Overlaps clips; later video, chapters and headlines ripple with the change.</span>
        </div>
        <span v-if="!clip.freeze" class="clip-path hint resolved-media-path">Project path: {{ clip.resolvedPath }}</span>
      </div>
    </div>
    <div class="tools">
      <button id="btnVideo" title="Preview videos stay on your computer, nothing is uploaded" @click="input.click()">Add videos…</button>
      <button id="btnRelinkMedia" ref="relinkButton" :disabled="!clips.length" aria-haspopup="dialog"
        aria-controls="media-relink-popover" :aria-expanded="relinkOpen" @click="showRelink">
        Relink media…<span v-if="missingCount" class="chip">{{ missingCount }} missing</span>
      </button>
      <input id="videoFile" ref="input" type="file" accept="video/*" multiple hidden @change="add">
      <input id="relinkFile" ref="relinkInput" type="file" accept="video/*" hidden @change="relink">
    </div>
    <div id="media-relink-popover" ref="relinkPopover" popover="auto" role="dialog"
      aria-labelledby="media-relink-title" class="media-relink-popover" :aria-busy="linking"
      @toggle="relinkOpen = $event.newState === 'open'" @keydown.stop>
      <div class="media-relink-heading">
        <h2 id="media-relink-title">Relink media</h2>
        <button class="ghost relink-close" autofocus aria-label="Close media relinking" @click="closeRelink">Close</button>
      </div>
      <p class="hint">Choose each missing source once to relink all clips that use it, including freeze frames.</p>
      <label class="inline"><input v-model="showLinked" type="checkbox">Show linked media too</label>
      <p v-if="!missingCount" role="status">All media is linked.</p>
      <p v-if="linkError" class="relink-error" role="alert">{{ linkError }}</p>
      <p v-if="linking" role="status">Checking {{ relinking.name }}…</p>
      <ul class="relink-items">
        <li v-for="entry in visibleLinks" :key="entry.clip.media_id ?? entry.clip.id" class="relink-item">
          <div>
            <strong>{{ entry.clip.name }}</strong>
            <span class="hint">Clips {{ entry.uses.join(', ') }} · {{ entry.missing ? 'Missing or invalid link' : 'Linked' }}</span>
            <span class="hint resolved-media-path">{{ entry.clip.resolvedPath ?? entry.clip.path }}</span>
          </div>
          <button class="relink-media" :data-media-id="entry.clip.media_id ?? entry.clip.id" :disabled="linking"
            :aria-label="`Relink ${entry.clip.name}`" @click="chooseMedia(entry.clip)">Choose file…</button>
        </li>
      </ul>
    </div>
    <p class="hint">Add one video per chapter, or one that covers several. Each plays from the time you set; <b>snap</b> moves it
      to the start of a chapter. Placements, source trims and relative media paths are saved in the project.
      Add a cross-dissolve on a clip to blend from the preceding clip; set its duration in seconds.
      Other overlaps are rejected. Gaps render black with silence.
      Use <b>Open project folder…</b> to link videos automatically, or <b>Relink media…</b> when opening only the JSON.</p>
  </section>
</template>
