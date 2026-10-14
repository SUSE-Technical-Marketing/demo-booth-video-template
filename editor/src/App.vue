<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import ChapterEditor from './components/ChapterEditor.vue';
import HeadlineEditor from './components/HeadlineEditor.vue';
import Preview from './components/Preview.vue';
import Timeline from './components/Timeline.vue';
import VideoList from './components/VideoList.vue';
import { downloadJSON, pickerOptions, rememberHandle, rememberedHandle } from './fileAccess.js';
import { clipEnd, loadClip, releaseClip } from './videos.js';
import { activeChapter, DEFAULT, duration, fitPx, fmt, fromJSON, newRow, parseClock,
  parseTime, plain, removeChapter, sortAll, tc, TEXT_SCALE, toJSON } from './timing.js';

const state = ref(fromJSON(DEFAULT));
const handle = shallowRef(null), reconnectHandle = shallowRef(null);
const dirty = ref(false), saving = ref(false), autosave = ref(true);
const cur = ref(0), selectedId = ref(null), playing = ref(false);
const offset = ref(3600), offsetText = ref('01:00:00'), rippleBy = ref(-5);
const message = ref(''), fontsVersion = ref(0);
const fileInput = ref(null), headlineEditor = ref(null), chapterEditor = ref(null);
const clips = ref([]);
const history = [];
let timer, saveTimer, toastTimer, lastTimestamp = 0, revision = 0, mounted = false;
const context = document.createElement('canvas').getContext('2d');
const totalDuration = computed(() => clips.value.length ? Math.max(...clips.value.map(clipEnd)) : duration(state.value));
const status = computed(() => dirty.value
  ? (handle.value ? 'unsaved changes…' : 'unsaved (not linked to a file)')
  : (handle.value ? `saved to ${handle.value.name}` : 'sample data: click Open file… and pick a timings/*.json'));
function measure(text, px) {
  fontsVersion.value;
  context.font = `500 ${px}px SUSE, system-ui, sans-serif`;
  return context.measureText(text).width;
}
const headlineFit = computed(() => {
  let best = { w: 1, idx: -1 };
  state.value.headlines.forEach((h, idx) => {
    const w = measure(plain(h.text), 70);
    if (w > best.w) best = { w, idx };
  });
  return { px: fitPx(best.w, 70, 1320), idx: best.idx };
});
const pillPx = computed(() => fitPx(Math.max(...state.value.chapters.map(c => measure(c, 28))), 28, 324));
const productPx = computed(() => fitPx(measure(state.value.product_name || 'SUSE AI Factory', 56), 56, 350));
const shortCount = computed(() => state.value.headlines.filter((h, i) => {
  const end = state.value.headlines[i + 1]?.t ?? state.value.headlines_end;
  return end != null && end - h.t < 3;
}).length);

async function addVideos(files) {
  stop();
  let added = 0;
  for (const file of files) {          // one at a time so they land in the order picked
    try {
      const start = clips.value.length ? Math.max(...clips.value.map(clipEnd)) : 0;
      clips.value.push(await loadClip(file, start));
      added++;
    } catch (error) { toast(error.message); }
  }
  if (added) toast(`Added ${added} ${added > 1 ? 'videos' : 'video'}`);
}
function updateClipStart(clip, time) {
  clip.start = Math.max(0, time);
  clips.value.sort((a, b) => a.start - b.start);
}
function removeClip(clip) {
  releaseClip(clip);
  clips.value.splice(clips.value.indexOf(clip), 1);
}
function clearClips() {
  clips.value.forEach(releaseClip);
  clips.value = [];
}
async function newVideo() {
  if (dirty.value && !window.confirm('You have unsaved changes. Start a new video anyway?')) return;
  loadState(fromJSON({
    title: 'New video', product_name: '', chapters: ['Chapter 1'], chapter_starts: [[0, 1]],
    headlines: [[0, 'Your first *headline*']], headlines_end: null, wipe_seconds: 0.8,
  }), null);
  clearClips();
  setCur(0);
  try { await rememberHandle(null); }          // a reload should not reopen the file we just left
  catch (error) { report('Could not forget the previous file', error); }
  toast('New video: edit, then Save to choose where the file goes');
}
function toast(text) {
  message.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { message.value = ''; }, 3500);
}
function report(prefix, error) {
  if (error.name !== 'AbortError') {
    console.error(prefix, error);
    toast(`${prefix}: ${error.message}`);
  }
}
function pushHistory() {
  const snapshot = JSON.stringify(state.value);
  if (history[history.length - 1] !== snapshot) history.push(snapshot);
  if (history.length > 100) history.shift();
}
function scheduleSave() {
  clearTimeout(saveTimer);
  if (mounted && dirty.value && handle.value && autosave.value) saveTimer = setTimeout(save, 700);
}
function markDirty() {
  revision++;
  dirty.value = true;
  scheduleSave();
}
function undo() {
  if (!history.length) return toast('Nothing to undo');
  state.value = JSON.parse(history.pop());
  selectedId.value = null;
  markDirty();
}
function stop() {
  playing.value = false;
  cancelAnimationFrame(timer);
}
function setCur(time) {
  cur.value = Math.max(0, time);
}
function seek(time) {
  stop();
  setCur(time);
}
function play() {
  if (playing.value) return stop();
  if (cur.value >= totalDuration.value - 1) cur.value = 0;
  playing.value = true;
  lastTimestamp = performance.now();
  const tick = timestamp => {
    if (!playing.value) return;
    cur.value = Math.min(totalDuration.value, cur.value + (timestamp - lastTimestamp) / 1000);
    lastTimestamp = timestamp;
    if (cur.value >= totalDuration.value) return stop();
    timer = requestAnimationFrame(tick);
  };
  timer = requestAnimationFrame(tick);
}
function activateHeadline(h) {
  selectedId.value = h.id;
  setCur(h.t + state.value.wipe_seconds + 0.2);
}
async function selectHeadline(h, focus = false) {
  activateHeadline(h);
  await nextTick();
  headlineEditor.value?.focusHeadline(h.id, focus);
}
function jump(direction) {
  const rows = state.value.headlines;
  const h = direction > 0 ? rows.find(h => h.t > cur.value + 0.5)
    : [...rows].reverse().find(h => h.t < cur.value - 0.5);
  if (h) selectHeadline(h);
}
function updateTime(row, time) {
  row.t = time;
  sortAll(state.value);
  setCur(time + state.value.wipe_seconds + 0.2);
  markDirty();
}
function commitTime() {
  sortAll(state.value);
}
async function addHeadline(after = null) {
  pushHistory();
  const h = newRow({ t: after ? +(after.t + 5).toFixed(1) : +cur.value.toFixed(1), text: 'New headline' });
  state.value.headlines.push(h);
  sortAll(state.value);
  markDirty();
  await selectHeadline(h, true);
}
function deleteHeadline(h) {
  if (state.value.headlines.length < 2) return toast('Keep at least one headline');
  pushHistory();
  state.value.headlines.splice(state.value.headlines.indexOf(h), 1);
  selectedId.value = null;
  markDirty();
}
function updateHeadline(h, text) {
  h.text = text;
  markDirty();
}
function setHeadlineToPlayhead(h) {
  pushHistory();
  h.t = +cur.value.toFixed(1);
  commitTime();
  markDirty();
}
async function addChapter() {
  pushHistory();
  state.value.chapters.push('New chapter');
  const ch = state.value.chapters.length;
  const chapter = newRow({ t: +cur.value.toFixed(1), ch });
  state.value.chapter_starts.push(chapter);
  sortAll(state.value);
  markDirty();
  await nextTick();
  chapterEditor.value.focusChapter(chapter.ch);
}
function addChapterSwitch() {
  pushHistory();
  state.value.chapter_starts.push(newRow({
    t: +cur.value.toFixed(1), ch: Math.min(state.value.chapters.length, activeChapter(state.value, cur.value) + 1),
  }));
  sortAll(state.value);
  markDirty();
}
function deleteSwitch(c) {
  if (state.value.chapter_starts.length < 2) return toast('Keep at least one chapter');
  pushHistory();
  state.value.chapter_starts.splice(state.value.chapter_starts.indexOf(c), 1);
  if (!state.value.chapter_starts.some(other => other.ch === c.ch) && state.value.chapters.length > 1) {
    removeChapter(state.value, c.ch);
  }
  sortAll(state.value);
  markDirty();
}
function deleteChapter(ch) {
  if (state.value.chapters.length < 2 || !state.value.chapter_starts.some(c => c.ch !== ch)) {
    return toast('Keep at least one chapter switch');
  }
  pushHistory();
  removeChapter(state.value, ch);
  markDirty();
}
function chooseChapter(c, value) {
  pushHistory();
  c.ch = +value;
  sortAll(state.value);
  markDirty();
}
function updateChapterTitle(ch, title) {
  state.value.chapters[ch - 1] = title;
  markDirty();
}
function updateMetadata(key, text) {
  state.value[key] = text;
  markDirty();
}
function updateEnd(event) {
  const text = event.target.value.trim(), time = text === '' ? null : parseTime(text, offset.value);
  if (time !== null && !Number.isFinite(time)) {
    event.target.value = state.value.headlines_end == null ? '' : fmt(state.value.headlines_end);
    return toast('Enter a valid headline end time, or leave it blank for clip end');
  }
  pushHistory();
  state.value.headlines_end = time;
  markDirty();
}
function updateWipe(event) {
  const seconds = +event.target.value;
  if (event.target.value === '' || !Number.isFinite(seconds) || seconds < 0) {
    event.target.value = state.value.wipe_seconds;
    return toast('Wipe duration must be a non-negative number');
  }
  pushHistory();
  state.value.wipe_seconds = seconds;
  markDirty();
}
function updateOffset() {
  const time = parseClock(offsetText.value);
  if (!Number.isFinite(time)) {
    offsetText.value = tc(0, offset.value);
    return toast('Enter a valid timeline start time');
  }
  offset.value = time;
  try { localStorage.setItem('timing_offset', offsetText.value); }
  catch (error) { report('Could not remember the timeline start', error); }
}
function ripple() {
  const by = +rippleBy.value;
  if (!Number.isFinite(by)) return toast('Enter a valid ripple amount');
  if (!by) return;
  pushHistory();
  const at = cur.value - 1e-6;
  const move = row => { if (row.t >= at) row.t = Math.max(0, +(row.t + by).toFixed(2)); };
  state.value.headlines.forEach(move);
  state.value.chapter_starts.forEach(move);
  if (state.value.headlines_end != null && state.value.headlines_end >= at) {
    state.value.headlines_end = Math.max(0, state.value.headlines_end + by);
  }
  sortAll(state.value);
  markDirty();
  toast(`Shifted everything from ${fmt(cur.value)} by ${by > 0 ? '+' : ''}${by} s`);
}
async function remember(fileHandle) {
  try { await rememberHandle(fileHandle); }
  catch (error) { report('File linked, but could not remember it for next visit', error); }
}
function loadState(next, fileHandle) {
  clearTimeout(saveTimer);
  stop();
  pushHistory();
  state.value = next;
  handle.value = fileHandle;
  reconnectHandle.value = null;
  dirty.value = false;
  selectedId.value = null;
  revision++;
}
async function loadFromHandle(fileHandle) {
  const next = fromJSON(JSON.parse(await (await fileHandle.getFile()).text()));
  loadState(next, fileHandle);
}
async function openFile() {
  if (saving.value) return toast('Wait for the current save to finish');
  if (!window.showOpenFilePicker) return fileInput.value.click();
  try {
    const [fileHandle] = await window.showOpenFilePicker(pickerOptions);
    await loadFromHandle(fileHandle);
    toast('Opened ' + fileHandle.name);
    await remember(fileHandle);
  } catch (error) { report('Open failed', error); }
}
async function importFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    loadState(fromJSON(JSON.parse(await file.text())), null);
    toast(`Opened ${file.name}; use Download to save changes in this browser`);
  } catch (error) { report('Open failed', error); }
  finally { event.target.value = ''; }
}
function checkedJSON() {
  const text = toJSON(state.value);
  fromJSON(JSON.parse(text));
  return text;
}
function download() {
  try {
    downloadJSON(checkedJSON());
    toast('Downloaded headline_timing.json');
  } catch (error) { report('Download failed', error); }
}
async function save() {
  if (saving.value) return;
  clearTimeout(saveTimer);
  saving.value = true;
  try {
    const text = checkedJSON(), savedRevision = revision;
    if (!handle.value) {
      if (!window.showSaveFilePicker) return download();
      handle.value = await window.showSaveFilePicker({ ...pickerOptions, suggestedName: 'headline_timing.json' });
      await remember(handle.value);
    }
    const writable = await handle.value.createWritable();
    await writable.write(text);
    await writable.close();
    if (revision === savedRevision) dirty.value = false;
    else scheduleSave();
    toast('Saved ' + handle.value.name);
  } catch (error) { report('Save failed', error); }
  finally { saving.value = false; }
}
async function reconnect() {
  try {
    const fileHandle = reconnectHandle.value;
    if (await fileHandle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
      return toast('File access was not granted');
    }
    await loadFromHandle(fileHandle);
    toast('Loaded ' + fileHandle.name);
  } catch (error) { report('Reconnect failed', error); }
}
async function connectRemembered() {
  const initialRevision = revision;
  try {
    const fileHandle = await rememberedHandle();
    if (!fileHandle || !fileHandle.queryPermission || !mounted || revision !== initialRevision) return;
    if (await fileHandle.queryPermission({ mode: 'readwrite' }) === 'granted') {
      const next = fromJSON(JSON.parse(await (await fileHandle.getFile()).text()));
      if (mounted && revision === initialRevision) {
        loadState(next, fileHandle);
        toast('Loaded ' + fileHandle.name);
      }
    } else if (mounted && revision === initialRevision) reconnectHandle.value = fileHandle;
  } catch (error) { report('Could not reconnect the remembered file', error); }
}
async function refreshFile() {
  const fileHandle = handle.value, initialRevision = revision;
  if (!fileHandle || dirty.value || saving.value) return;
  try {
    if (await fileHandle.queryPermission({ mode: 'read' }) !== 'granted') return;
    const next = fromJSON(JSON.parse(await (await fileHandle.getFile()).text()));
    if (mounted && !dirty.value && revision === initialRevision && handle.value === fileHandle &&
        toJSON(next) !== toJSON(state.value)) {
      loadState(next, fileHandle);
      toast('Updated from file');
    }
  } catch (error) { report('Could not refresh the linked file', error); }
}
function keydown(event) {
  const target = document.activeElement;
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName);
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault(); save();
  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' &&
      !(typing && target.type === 'text' && !target.classList.contains('time'))) {
    event.preventDefault(); undo();
  } else if (!typing && event.code === 'Space') {
    event.preventDefault(); play();
  } else if (!typing && event.key === ',') jump(-1);
  else if (!typing && event.key === '.') jump(1);
}
function beforeUnload(event) {
  if (dirty.value) { event.preventDefault(); event.returnValue = ''; }
}
onMounted(() => {
  mounted = true;
  try {
    const stored = localStorage.getItem('timing_offset');
    if (stored && Number.isFinite(parseClock(stored))) {
      offsetText.value = stored;
      offset.value = parseClock(stored);
    }
  } catch (error) { report('Could not restore the timeline start', error); }
  connectRemembered();
  if (document.fonts?.load) {
    document.fonts.load('500 20px SUSE').then(() => { if (mounted) fontsVersion.value++; })
      .catch(error => report('Could not load the SUSE font', error));
  }
  document.addEventListener('keydown', keydown);
  window.addEventListener('focus', refreshFile);
  window.addEventListener('beforeunload', beforeUnload);
});
onUnmounted(() => {
  mounted = false;
  stop();
  clearTimeout(saveTimer);
  clearTimeout(toastTimer);
  document.removeEventListener('keydown', keydown);
  window.removeEventListener('focus', refreshFile);
  window.removeEventListener('beforeunload', beforeUnload);
});
</script>

<template>
  <header class="top">
    <h1>Timing editor</h1>
    <button id="btnNew" title="Start a blank timing file and clear the loaded videos" @click="newVideo">New</button>
    <button id="btnOpen" title="Open a timing JSON file" @click="openFile">Open file…</button>
    <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="importFile">
    <button v-if="reconnectHandle" id="btnReconnect" class="primary" @click="reconnect">Reconnect {{ reconnectHandle.name }}</button>
    <button id="btnSave" class="primary" title="Cmd/Ctrl+S" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save' }}</button>
    <button id="btnDownload" class="ghost" @click="download">Download</button>
    <label class="inline"><input id="autosave" v-model="autosave" type="checkbox" @change="scheduleSave"> autosave</label>
    <span id="status" class="status" :class="{ dirty, ok: !dirty && handle }">{{ status }}</span>
    <span class="spacer"></span>
    <label class="inline" title="Timecode shown in Resolve at the start of the clip. Times typed as h:mm:ss have this subtracted.">
      timeline starts at <input id="offset" v-model="offsetText" size="8" @change="updateOffset"></label>
    <button id="btnUndo" class="ghost" title="Cmd/Ctrl+Z" @click="undo">Undo</button>
    <a href="https://github.com/SUSE-Technical-Marketing/demo-booth-video-template#readme" target="_blank" rel="noopener" class="help">Help</a>
  </header>

  <main>
    <div class="stack">
      <section class="card">
        <h2>Timeline <span id="durChip" class="chip">to {{ fmt(totalDuration) }}</span></h2>
        <Timeline :state="state" :duration="totalDuration" :cur="cur" :selected-id="selectedId" :clips="clips" @seek="seek" />
        <p class="hint">Click or drag on the timeline to scrub. Click a row below to jump to it.</p>
      </section>

      <VideoList :clips="clips" :switches="state.chapter_starts" @add="addVideos" @update-start="updateClipStart"
        @remove="removeClip" @error="toast" />

      <ChapterEditor ref="chapterEditor" :chapters="state.chapters" :switches="state.chapter_starts"
        :title="state.title" :product="state.product_name" :offset="offset"
        @begin-edit="pushHistory" @update-time="updateTime" @commit-time="commitTime" @error="toast"
        @select="setCur($event.t + 0.1)" @choose-chapter="chooseChapter" @update-chapter-title="updateChapterTitle"
        @delete-switch="deleteSwitch" @delete-chapter="deleteChapter" @add-chapter="addChapter"
        @add-switch="addChapterSwitch" @update-metadata="updateMetadata" />

      <HeadlineEditor ref="headlineEditor" :headlines="state.headlines" :end="state.headlines_end"
        :wipe="state.wipe_seconds" :offset="offset" :selected-id="selectedId" :text-size-index="headlineFit.idx"
        @begin-edit="pushHistory" @update-time="updateTime" @commit-time="commitTime" @error="toast"
        @select="activateHeadline" @update-text="updateHeadline" @add-headline="addHeadline"
        @set-playhead="setHeadlineToPlayhead" @delete-headline="deleteHeadline"
        @change-end="updateEnd" @change-wipe="updateWipe" />

      <section class="card">
        <h2>Ripple <span class="heading-hint">cut dead space? slide everything after the playhead</span></h2>
        <div class="tools ripple-tools">
          <span>Shift all chapters &amp; headlines at or after <b id="rippleAt">{{ fmt(cur) }}</b> by</span>
          <input id="rippleBy" v-model="rippleBy" type="number" step="0.5" aria-label="Ripple seconds"> s
          <button id="btnRipple" @click="ripple">Apply</button>
        </div>
      </section>
    </div>

    <aside class="sticky">
      <Preview :state="state" :cur="cur" :headline-px="headlineFit.px" :pill-px="pillPx" :product-px="productPx" :clips="clips" :playing="playing" />
      <div class="transport">
        <button id="btnPlay" class="primary" @click="play">{{ playing ? 'Pause' : 'Play' }}</button>
        <input id="scrub" type="range" min="0" :max="totalDuration" step="0.1" :value="cur" aria-label="Preview time"
          @input="seek(+$event.target.value)">
        <div id="timelabel" class="timelabel">{{ fmt(cur) }}<small>{{ tc(cur, offset) }}</small></div>
      </div>
      <div id="stats" class="statline">
        <span class="chip">{{ state.headlines.length }} headlines</span>
        <span class="chip">{{ state.chapters.length }} chapters</span>
        <span class="chip">{{ state.chapter_starts.length }} chapter switches</span>
        <span class="chip info">headline text ≈ {{ (headlineFit.px / TEXT_SCALE).toFixed(0) }} px{{ headlineFit.idx >= 0 ? ` (set by #${headlineFit.idx + 1})` : '' }}</span>
        <span v-if="shortCount" class="chip warn">{{ shortCount }} shorter than 3 s</span>
      </div>
      <div class="hint preview-hint">Preview is an approximation of the Fusion result. <kbd>Space</kbd> play/pause · <kbd>,</kbd> <kbd>.</kbd> previous / next headline.</div>
    </aside>
  </main>
  <div id="toast" class="toast" :class="{ show: message }" role="status">{{ message }}</div>
</template>
