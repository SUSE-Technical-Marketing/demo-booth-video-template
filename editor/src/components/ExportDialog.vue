<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { canChooseLocation, chooseLocation, formatBytes, formatEta, getInfo, QUALITIES, removeJob, runExport, saveVideo, sizeHint, slowdown } from '../exporter.js';
import { DEFAULT_RESOLUTION, RESOLUTIONS } from '../project.js';
import { fmt } from '../timing.js';

const props = defineProps({
  clips: { type: Array, required: true },            // the project's clips, each with media_id, name and url (set when linked)
  files: { type: Object, required: true },           // Map: media id -> the File that was linked
  getProject: { type: Function, required: true },    // returns the project file's JSON text (throws if it is invalid)
  resolution: { type: String, default: DEFAULT_RESOLUTION },
  startIn: { type: Object, default: null },          // project folder or file handle: the save picker opens there
  title: { type: String, default: '' },
  duration: { type: Number, default: 0 },
});
const emit = defineEmits(['close']);

const info = ref(null), checking = ref(true);
const size = ref(props.resolution), quality = ref('standard'), fast = ref(false), audio = ref(true);
const filename = ref((props.title || 'booth-video').replace(/[^\w .-]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'booth-video');
const stage = ref('form');                           // form | running | done | error
const update = ref({ phase: 'uploading', fraction: 0, message: '' });
const errorText = ref(''), result = ref(null), saved = ref(null), target = shallowRef(null);
const canChoose = canChooseLocation(), saveError = ref('');
const dialog = ref(null), nameInput = ref(null);
let controller = null;

const sizes = computed(() => RESOLUTIONS.some(([value]) => value === size.value) ? RESOLUTIONS : [[size.value, size.value], ...RESOLUTIONS]);
const width = computed(() => size.value.split('x')[0]), height = computed(() => size.value.split('x')[1]);
const missing = computed(() => [...new Set(props.clips.filter(c => !props.files.has(c.media_id)).map(c => c.name))]);
const videoCount = computed(() => new Set(props.clips.map(c => c.media_id)).size);
const factor = computed(() => slowdown(size.value, quality.value));
const hardware = computed(() => Boolean(info.value?.encoders?.h264_videotoolbox));
const ready = computed(() => props.clips.length > 0 && !missing.value.length);
const percent = computed(() => Math.round(update.value.fraction * 100));
const speed = computed(() => factor.value < 0.8 ? 'Quick render' : factor.value < 1.5 ? 'About as fast as 1080p Standard'
  : `About ${factor.value.toFixed(factor.value < 10 ? 1 : 0)}× slower than 1080p Standard`);
const phaseLabel = computed(() => update.value.message || 'Working…');
const detail = computed(() => {
  const u = update.value;
  if (u.phase === 'uploading' && u.total) return `${formatBytes(u.uploaded)} of ${formatBytes(u.total)}`;
  if (u.phase === 'rendering') return [u.fps ? `${u.fps.toFixed(0)} frames/s` : '', formatEta(u.eta)].filter(Boolean).join(' · ');
  return '';
});

async function check() {
  checking.value = true;
  info.value = await getInfo();
  checking.value = false;
}
async function start() {
  let project;
  try { project = props.getProject(); }
  catch (error) { errorText.value = `The project is not valid: ${error.message}`; stage.value = 'error'; return; }
  controller = new AbortController();
  stage.value = 'running';
  update.value = { phase: 'uploading', fraction: 0, message: 'Starting' };
  try {
    result.value = await runExport({
      project, files: props.files, size: size.value, quality: quality.value,
      fast: fast.value && hardware.value, audio: audio.value, filename: filename.value, signal: controller.signal,
      onUpdate: value => { update.value = value; },
    });
    stage.value = 'done';
    if (target.value) await save();               // a location was chosen up front: write there straight away
  } catch (error) {
    if (error.name === 'AbortError') { stage.value = 'form'; return; }
    errorText.value = error.message;
    stage.value = 'error';
  } finally { controller = null; }
}
function cancel() { controller?.abort(); }
// A chosen location belongs to one export and to one file name: the name field follows it, and typing a different
// name drops it, so a later export can never be written over an earlier file by accident.
const stem = name => name.replace(/\.mp4$/i, '');
async function choose() {
  try {
    const picked = await chooseLocation(`${filename.value.trim() || 'booth-video'}.mp4`, props.startIn);
    filename.value = stem(picked.name);
    target.value = picked;
  }
  catch (error) { if (error.name !== 'AbortError') { errorText.value = error.message; stage.value = 'error'; } }
}
async function save(askAgain = false) {
  try {
    saved.value = await saveVideo(result.value, result.value.view.filename,
      { target: askAgain === true ? null : target.value, startIn: props.startIn });
  } catch (error) {
    if (error.name !== 'AbortError') saveError.value = error.message;
  }
}
watch(filename, name => { if (target.value && stem(target.value.name) !== name.trim()) target.value = null; });
function again() {
  if (result.value) removeJob(result.value.job);
  result.value = null; saved.value = null; saveError.value = ''; target.value = null;   // the next export picks its own location
  stage.value = 'form';
}
function close() { if (stage.value === 'running') return; emit('close'); }
function keydown(event) { if (event.key === 'Escape') close(); }

onMounted(async () => {
  document.addEventListener('keydown', keydown);
  await check();
  await nextTick();
  nameInput.value?.focus();
});
onUnmounted(() => {
  document.removeEventListener('keydown', keydown);
  controller?.abort();
  if (result.value) removeJob(result.value.job);
});
</script>

<template>
  <div class="export-overlay" @mousedown.self="close">
    <section ref="dialog" class="export-dialog" role="dialog" aria-modal="true" aria-labelledby="exportTitle">
      <header class="export-head">
        <svg class="export-glyph" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div><h2 id="exportTitle">Export video</h2>
          <p>Render the finished, branded MP4 with the chapter panel and headlines.</p></div>
        <button class="icon ghost export-x" aria-label="Close" :disabled="stage === 'running'" @click="close">✕</button>
      </header>

      <div v-if="checking" class="export-body"><p class="export-note">Looking for the export service…</p></div>

      <div v-else-if="!info" id="exportUnavailable" class="export-body">
        <div class="export-callout">
          <strong>The export service isn't running.</strong>
          <p>Exporting needs ffmpeg, so it runs next to the editor on your computer. Start the editor with
            <code>start_editor.command</code> (or <code>mise run run</code>) and it starts automatically, or run
            <code>python3 render/server.py</code> in another terminal. The hosted copy of the editor can't export.</p>
        </div>
        <footer class="export-foot"><button class="ghost" @click="emit('close')">Close</button>
          <button id="exportRetry" class="primary" @click="check">Check again</button></footer>
      </div>

      <div v-else-if="stage === 'form'" class="export-body">
        <div v-if="!clips.length" id="exportNoVideo" class="export-callout warn">
          <strong>Add a video first.</strong>
          <p>Use <b>Add videos…</b> in <i>Videos</i>. The export wraps your recording in the layout.</p>
        </div>
        <div v-else-if="missing.length" id="exportMissing" class="export-callout warn">
          <strong>{{ missing.length === 1 ? 'A video is' : 'Some videos are' }} not linked.</strong>
          <p>Link {{ missing.join(', ') }} in <i>Videos</i> (<b>Relink media…</b> or <b>Open project folder…</b>) so it can be rendered.</p>
        </div>

        <label class="export-field"><span>File name</span>
          <span class="export-name"><input ref="nameInput" id="exportName" v-model="filename" spellcheck="false" aria-label="File name"><em>.mp4</em></span></label>

        <div class="export-field"><span id="saveLabel">Save to</span>
          <div v-if="canChoose" class="export-where">
            <span id="exportTarget" :class="{ chosen: target }">{{ target ? target.name : (startIn ? 'Asks when it is done, starting in your project folder' : 'Asks when it is done') }}</span>
            <button id="exportChoose" type="button" aria-labelledby="saveLabel" @click="choose">{{ target ? 'Change…' : 'Choose location…' }}</button>
            <button v-if="target" type="button" class="ghost" aria-label="Forget the chosen location" @click="target = null">✕</button>
          </div>
          <small v-else id="exportTarget">This browser can't choose a folder: the video goes to your Downloads folder. Use Chrome or Edge to pick the location.</small>
        </div>

        <div class="export-field"><span id="resLabel">Resolution</span>
          <div class="export-select">
            <select id="exportResolution" v-model="size" aria-labelledby="resLabel">
              <option v-for="[value, label] in sizes" :key="value" :value="value">{{ label }}{{ value === props.resolution ? ' · project setting' : '' }}</option>
            </select>
          </div>
          <small id="resHint">{{ sizeHint(size) }}. Only this export changes; the project's own setting stays as it is.</small>
        </div>

        <div class="export-field"><span id="qualLabel">Quality</span>
          <div class="export-seg" role="radiogroup" aria-labelledby="qualLabel">
            <button v-for="q in QUALITIES" :key="q.id" type="button" role="radio" :aria-checked="quality === q.id"
              :class="{ on: quality === q.id }" :data-quality="q.id" @click="quality = q.id">
              {{ q.name }}<small>{{ q.hint }}</small></button>
          </div>
        </div>

        <label class="export-check"><input id="exportAudio" v-model="audio" type="checkbox">
          <span>Include audio <small>Turn off to export video without an audio track. Preview and project settings stay unchanged.</small></span></label>

        <label v-if="hardware" class="export-check"><input id="exportFast" v-model="fast" type="checkbox">
          <span>Use the Mac hardware encoder <small>(much faster, slightly larger files, quality setting is ignored)</small></span></label>

        <div class="export-chips" aria-label="Summary">
          <span class="chip">{{ width }} × {{ height }}</span>
          <span class="chip">H.264 · MP4</span>
          <span class="chip">{{ audio ? 'With audio' : 'No audio' }}</span>
          <span class="chip">{{ videoCount }} {{ videoCount === 1 ? 'video' : 'videos' }}</span>
          <span class="chip">{{ fmt(duration) }} long</span>
          <span id="exportSpeed" class="chip" :class="factor >= 3 ? 'warn' : 'info'">{{ speed }}</span>
        </div>
        <p v-if="clips.length > 1" class="export-note">Clips play from their start times and trims; any gap between them is black and silent.</p>

        <footer class="export-foot"><button class="ghost" @click="emit('close')">Cancel</button>
          <button id="exportStart" class="primary" :disabled="!ready || !filename.trim()" @click="start">Start export</button></footer>
      </div>

      <div v-else-if="stage === 'running'" id="exportRunning" class="export-body">
        <p class="export-phase">{{ phaseLabel }}</p>
        <div class="export-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="percent">
          <i :style="{ width: percent + '%' }"></i></div>
        <p class="export-detail"><b>{{ percent }}%</b><span>{{ detail }}</span></p>
        <p class="export-note">Keep this tab open. Everything stays on your computer.</p>
        <footer class="export-foot"><button id="exportCancel" @click="cancel">Cancel export</button></footer>
      </div>

      <div v-else-if="stage === 'done'" id="exportDone" class="export-body">
        <div class="export-callout ok">
          <strong>Your video is ready.</strong>
          <p>{{ result.view.filename }} · {{ formatBytes(result.view.size) }} · {{ width }} × {{ height }}</p>
          <p v-if="saved" id="exportSaved" class="export-saved">Saved as {{ saved.name }} in {{ saved.where }}.</p>
          <p v-if="saveError" id="exportSaveError" class="export-saved bad">{{ saveError }}</p>
        </div>
        <footer class="export-foot"><button class="ghost" @click="again">Export another</button>
          <button id="exportSave" class="primary" @click="save(true)">{{ saved ? 'Save another copy…' : 'Save video…' }}</button></footer>
      </div>

      <div v-else id="exportError" class="export-body">
        <div class="export-callout bad"><strong>The export didn't finish.</strong><pre>{{ errorText }}</pre></div>
        <footer class="export-foot"><button class="ghost" @click="emit('close')">Close</button>
          <button class="primary" @click="stage = 'form'">Back</button></footer>
      </div>
    </section>
  </div>
</template>
