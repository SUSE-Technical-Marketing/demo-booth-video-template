<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import ChapterEditor from './components/ChapterEditor.vue';
import EditorWorkspace from './components/EditorWorkspace.vue';
import Preview from './components/Preview.vue';
import TimelineDock from './components/TimelineDock.vue';
import VideoList from './components/VideoList.vue';
import { downloadJSON, pickerOptions, rememberHandle, rememberedHandle } from './fileAccess.js';
import { clipEnd, loadClip, releaseClip } from './videos.js';
import { activeChapter, chapterImportNotice, DEFAULT, duration, fitPx, fmt, fromJSON, headlineChapter, headlineEnd,
  headlineOutside, headlineTime, newRow, parseClock,
  parseTime, plain, removeChapter, sortAll, tc, TEXT_SCALE, toJSON } from './timing.js';

const state = ref(fromJSON(DEFAULT));
const handle = shallowRef(null), reconnectHandle = shallowRef(null);
const dirty = ref(false), saving = ref(false), autosave = ref(true);
const cur = ref(0), selectedId = ref(null), playing = ref(false);
const selectedChapterId = ref(state.value.chapter_starts[0].id), followPlayhead = ref(false);
const playingChapter = computed(() => state.value.chapter_starts.find(c => c.ch === activeChapter(state.value, cur.value)));
watch(() => state.value.chapter_starts.map(c => c.id), ids => {
  if (!ids.includes(selectedChapterId.value)) selectedChapterId.value = ids[0];
  if (!state.value.headlines.some(h => h.id === selectedId.value)) selectedId.value = null;
});
watch([followPlayhead, playingChapter], ([follow, chapter]) => {
  if (follow && selectedChapterId.value !== chapter.id) {
    selectedChapterId.value = chapter.id;
    selectedId.value = null;
  }
});
const offset = ref(3600), offsetText = ref('01:00:00'), rippleBy = ref(-5);
const message = ref(''), fontsVersion = ref(0);
const fileInput = ref(null), chapterEditor = ref(null);
const clips = ref([]);
const history = [];
let timer, saveTimer, toastTimer, lastTimestamp = 0, revision = 0, mounted = false;
const context = document.createElement('canvas').getContext('2d');
const totalDuration = computed(() => clips.value.length ? Math.max(...clips.value.map(clipEnd)) : duration(state.value));
watch(totalDuration, end => {
  if (!clips.value.length && state.value.chapters_end != null && cur.value > end) seek(end);
});
const previewState = computed(() => ({ ...state.value, preview_end: totalDuration.value }));
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
const shortCount = computed(() => state.value.headlines.filter(h => !headlineOutside(state.value, h, totalDuration.value) &&
  headlineEnd(state.value, h, totalDuration.value) - headlineTime(state.value, h) < 3).length);

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
function toast(text, notice = '') {
  message.value = notice ? `${text}; ${notice}` : text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { message.value = ''; }, notice ? 8000 : 3500);
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
function beginEdit() {
  followPlayhead.value = false;
  pushHistory();
}
function chooseChapter(chapter) {      // from the chapter list: the editing panel and the timeline both go there
  selectChapter(chapter);
  setCur(chapter.t + 0.1);
}
function moveHeadline(h, time) {       // dragged on the timeline: h.t is relative to its chapter
  const chapter = state.value.chapter_starts.find(c => c.id === h.chapterId);
  h.t = +(time - chapter.t).toFixed(2);
  selectedChapterId.value = chapter.id;
  selectedId.value = h.id;
  setCur(time);
  markDirty();
}
function moveHeadlineEnd(h, time) {    // time = null puts the end back to automatic
  const chapter = state.value.chapter_starts.find(c => c.id === h.chapterId);
  h.end = time == null ? null : +(time - chapter.t).toFixed(2);
  selectedChapterId.value = chapter.id;
  selectedId.value = h.id;
  setCur(Math.max(headlineTime(state.value, h), (time ?? headlineEnd(state.value, h, totalDuration.value)) - 0.5));
  markDirty();
}
function selectChapter(chapter) {
  followPlayhead.value = false;
  selectedChapterId.value = chapter.id;
  selectedId.value = null;
}
async function selectTimelineHeadline(h) {
  followPlayhead.value = false;
  selectedChapterId.value = h.chapterId;
  selectedId.value = h.id;
  await nextTick();
  chapterEditor.value.focusHeadline(h.id);
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
  const current = JSON.stringify(state.value);
  while (history.length && history.at(-1) === current) history.pop();
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
  stop();
  followPlayhead.value = false;
  selectedChapterId.value = h.chapterId;
  selectedId.value = h.id;
  setCur(headlineTime(state.value, h) + state.value.wipe_seconds + 0.2);
}
async function selectHeadline(h, focus = false) {
  activateHeadline(h);
  await nextTick();
  chapterEditor.value?.focusHeadline(h.id, focus);
}
function jump(direction) {
  const rows = state.value.headlines.filter(h => !headlineOutside(state.value, h, totalDuration.value));
  const h = direction > 0 ? rows.find(h => headlineTime(state.value, h) > cur.value + 0.5)
    : [...rows].reverse().find(h => headlineTime(state.value, h) < cur.value - 0.5);
  if (h) selectHeadline(h);
}
function updateTime(row, time) {
  row.t = time;
  sortAll(state.value);
  setCur((row.chapterId == null ? time : headlineTime(state.value, row)) + state.value.wipe_seconds + 0.2);
  markDirty();
}
function commitTime() {
  sortAll(state.value);
}
async function addHeadline(chapter, after = null) {
  pushHistory();
  const h = newRow({ t: after ? +(after.t + 5).toFixed(1) : Math.max(0, +(cur.value - chapter.t).toFixed(1)),
    text: 'New headline', chapterId: chapter.id });
  state.value.headlines.push(h);
  sortAll(state.value);
  markDirty();
  await selectHeadline(h, true);
}
function deleteHeadline(h) {
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
  h.t = +(cur.value - headlineChapter(state.value, h).t).toFixed(1);
  commitTime();
  markDirty();
}
async function addChapter() {
  pushHistory();
  state.value.chapters.push('New chapter');
  const ch = state.value.chapters.length;
  const chapter = newRow({ t: +cur.value.toFixed(1), ch });
  state.value.chapter_starts.push(chapter);
  selectChapter(chapter);
  sortAll(state.value);
  markDirty();
  await nextTick();
  chapterEditor.value.focusChapter(chapter.ch);
}
function deleteChapter(ch) {
  if (state.value.chapters.length < 2) return toast('Keep at least one chapter');
  pushHistory();
  const index = state.value.chapter_starts.findIndex(c => c.ch === ch);
  const deletingSelected = state.value.chapter_starts[index].id === selectedChapterId.value;
  removeChapter(state.value, ch);
  if (deletingSelected) selectChapter(state.value.chapter_starts[Math.min(index, state.value.chapter_starts.length - 1)]);
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
function updateChaptersEnd(event) {
  const text = event.target.value.trim(), time = text === '' ? null : parseTime(text, offset.value);
  if (time !== null && (!Number.isFinite(time) || time < 0.01 || time <= state.value.chapter_starts.at(-1).t)) {
    event.target.value = state.value.chapters_end == null ? '' : fmt(state.value.chapters_end);
    return toast('Enter an end after the last chapter starts, or leave it blank for automatic end');
  }
  event.target.value = time == null ? '' : fmt(time);
  pushHistory();
  state.value.chapters_end = time;
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
  const at = cur.value - 1e-6;
  if (state.value.chapters_end != null && state.value.chapters_end >= at && state.value.chapters_end + by < 0.01) {
    return toast('Ripple would move the last chapter end before 0.01 seconds; use a smaller amount');
  }
  pushHistory();
  const move = row => { if (row.t >= at) row.t = Math.max(0, +(row.t + by).toFixed(2)); };
  const headlineTimes = state.value.headlines.map(h => [h, headlineTime(state.value, h)]);
  state.value.chapter_starts.forEach(move);
  headlineTimes.forEach(([h, time]) => {
    const shifted = time >= at ? Math.max(0, +(time + by).toFixed(2)) : time;
    h.t = +(shifted - headlineChapter(state.value, h).t).toFixed(2);
  });
  if (state.value.headlines_end != null && state.value.headlines_end >= at) {
    state.value.headlines_end = Math.max(0, state.value.headlines_end + by);
  }
  if (state.value.chapters_end != null && state.value.chapters_end >= at) {
    state.value.chapters_end = +(state.value.chapters_end + by).toFixed(2);
  }
  sortAll(state.value);
  markDirty();
  toast(`Shifted everything from ${fmt(cur.value)} by ${by > 0 ? '+' : ''}${by} s`);
}
async function remember(fileHandle) {
  try { await rememberHandle(fileHandle); }
  catch (error) { report('File linked, but could not remember it for next visit', error); }
}
function loadState(next, fileHandle, notice = '') {
  clearTimeout(saveTimer);
  stop();
  pushHistory();
  state.value = next;
  handle.value = fileHandle;
  reconnectHandle.value = null;
  dirty.value = Boolean(notice);
  selectedId.value = null;
  selectedChapterId.value = next.chapter_starts[0].id;
  followPlayhead.value = false;
  revision++;
}
function readTiming(text) {
  const source = JSON.parse(text);
  return { next: fromJSON(source), notice: chapterImportNotice(source) };
}
async function loadFromHandle(fileHandle) {
  const { next, notice } = readTiming(await (await fileHandle.getFile()).text());
  loadState(next, fileHandle, notice);
  return notice;
}
async function openFile() {
  if (saving.value) return toast('Wait for the current save to finish');
  if (!window.showOpenFilePicker) return fileInput.value.click();
  try {
    const [fileHandle] = await window.showOpenFilePicker(pickerOptions);
    const notice = await loadFromHandle(fileHandle);
    toast('Opened ' + fileHandle.name, notice);
    await remember(fileHandle);
  } catch (error) { report('Open failed', error); }
}
async function importFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const { next, notice } = readTiming(await file.text());
    loadState(next, null, notice);
    toast(`Opened ${file.name}; use Download to save changes in this browser`, notice);
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
// Save writes to the linked file, asking for one the first time. Save As always asks, then links to the new file
// (the old file is left as it was); cancelling the picker changes nothing.
async function save(saveAs = false) {
  if (saving.value) return;
  clearTimeout(saveTimer);
  saving.value = true;
  try {
    const text = checkedJSON(), savedRevision = revision;
    let target = handle.value;
    if (!target || saveAs === true) {
      if (!window.showSaveFilePicker) return download();
      target = await window.showSaveFilePicker({ ...pickerOptions, suggestedName: handle.value?.name ?? 'headline_timing.json' });
    }
    const writable = await target.createWritable();
    await writable.write(text);
    await writable.close();
    if (target !== handle.value) {
      handle.value = target;
      reconnectHandle.value = null;
      await remember(target);
    }
    if (revision === savedRevision) dirty.value = false;
    else scheduleSave();
    toast('Saved ' + target.name);
  } catch (error) { report('Save failed', error); }
  finally { saving.value = false; }
}
async function reconnect() {
  try {
    const fileHandle = reconnectHandle.value;
    if (await fileHandle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
      return toast('File access was not granted');
    }
    const notice = await loadFromHandle(fileHandle);
    toast('Loaded ' + fileHandle.name, notice);
  } catch (error) { report('Reconnect failed', error); }
}
async function connectRemembered() {
  const initialRevision = revision;
  try {
    const fileHandle = await rememberedHandle();
    if (!fileHandle || !fileHandle.queryPermission || !mounted || revision !== initialRevision) return;
    if (await fileHandle.queryPermission({ mode: 'readwrite' }) === 'granted') {
      const { next, notice } = readTiming(await (await fileHandle.getFile()).text());
      if (mounted && revision === initialRevision) {
        loadState(next, fileHandle, notice);
        toast('Loaded ' + fileHandle.name, notice);
      }
    } else if (mounted && revision === initialRevision) reconnectHandle.value = fileHandle;
  } catch (error) { report('Could not reconnect the remembered file', error); }
}
async function refreshFile() {
  const fileHandle = handle.value, initialRevision = revision;
  if (!fileHandle || dirty.value || saving.value) return;
  try {
    if (await fileHandle.queryPermission({ mode: 'read' }) !== 'granted') return;
    const { next, notice } = readTiming(await (await fileHandle.getFile()).text());
    if (mounted && !dirty.value && revision === initialRevision && handle.value === fileHandle &&
        (notice || toJSON(next) !== toJSON(state.value))) {
      loadState(next, fileHandle, notice);
      toast('Updated from file', notice);
    }
  } catch (error) { report('Could not refresh the linked file', error); }
}
function keydown(event) {
  const target = document.activeElement;
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName);
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault(); save(event.shiftKey);
  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' &&
      !(typing && target.type === 'text' && !target.classList.contains('time'))) {
    event.preventDefault(); undo();
  } else if (!typing && !target.closest('button, summary, a, [role="separator"]') && event.code === 'Space') {
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
    <button id="btnSave" class="primary" title="Cmd/Ctrl+S" :disabled="saving" @click="save()">{{ saving ? 'Saving…' : 'Save' }}</button>
    <button id="btnSaveAs" title="Save a copy under a new name and keep working in it (Cmd/Ctrl+Shift+S)" :disabled="saving" @click="save(true)">Save as…</button>
    <button id="btnDownload" class="ghost" @click="download">Download</button>
    <label class="inline"><input id="autosave" v-model="autosave" type="checkbox" @change="scheduleSave"> autosave</label>
    <span id="status" class="status" :class="{ dirty, ok: !dirty && handle }">{{ status }}</span>
    <span class="spacer"></span>
    <label class="inline" title="Timecode your video editor shows at the start of the clip (often 01:00:00). Times typed as h:mm:ss have this subtracted.">
      timeline starts at <input id="offset" v-model="offsetText" size="8" @change="updateOffset"></label>
    <button id="btnUndo" class="ghost" title="Cmd/Ctrl+Z" @click="undo">Undo</button>
    <a href="https://github.com/SUSE-Technical-Marketing/demo-booth-video-template#readme" target="_blank" rel="noopener" class="help">Help</a>
  </header>

  <EditorWorkspace>
    <template #editor>
      <aside id="editor-panel" class="editor-panel" aria-label="Chapters and headlines" tabindex="0">
        <ChapterEditor ref="chapterEditor" :chapters="state.chapters" :starts="state.chapter_starts" :headlines="state.headlines"
          :offset="offset" :end="totalDuration" :selected-chapter-id="selectedChapterId"
          :playing-chapter-id="playingChapter.id" :follow-playhead="followPlayhead"
          :headline-end="state.headlines_end" :selected-id="selectedId"
          :chapters-end="state.chapters_end" @change-chapters-end="updateChaptersEnd"
          :text-size-id="state.headlines[headlineFit.idx]?.id"
          @begin-edit="beginEdit" @update-time="updateTime" @commit-time="commitTime" @error="toast"
          @select="chooseChapter" @update-chapter-title="updateChapterTitle" @update-follow="followPlayhead = $event"
          @delete-chapter="deleteChapter" @add-chapter="addChapter"
          @select-headline="activateHeadline" @update-text="updateHeadline" @add-headline="addHeadline"
          @set-playhead="setHeadlineToPlayhead" @delete-headline="deleteHeadline"
        />

        <details class="project-settings">
          <summary>Videos and project settings<span v-if="clips.length"> · {{ clips.length }} videos</span></summary>
          <VideoList :clips="clips" :starts="state.chapter_starts" @add="addVideos" @update-start="updateClipStart"
            @remove="removeClip" @error="toast" />
          <section class="card">
            <h2>Video title and product</h2>
            <div id="meta" class="names">
              <label class="inline">title <input id="titleIn" :value="state.title" placeholder="Video title (for your own reference)"
                @focus="beginEdit" @input="updateMetadata('title', $event.target.value)"></label>
              <label class="inline">product <input id="productIn" :value="state.product_name" placeholder="Shown under the logo"
                @focus="beginEdit" @input="updateMetadata('product_name', $event.target.value)"></label>
            </div>
          </section>
        <section class="card">
          <h2>Headline settings</h2>
          <div class="tools">
            <label class="inline">headlines end at <input id="endAt" :value="state.headlines_end == null ? '' : fmt(state.headlines_end)"
              size="7" placeholder="video end" @change="updateEnd"></label>
            <label class="inline">wipe <input id="wipe" :value="state.wipe_seconds" type="number"
              min="0" max="3" step="0.1" @change="updateWipe"> s</label>
          </div>
        </section>
        <section class="card">
          <h2>Ripple <span class="heading-hint">cut dead space? slide everything after the playhead</span></h2>
          <div class="tools ripple-tools">
            <span>Shift all chapters &amp; headlines at or after <b id="rippleAt">{{ fmt(cur) }}</b> by</span>
            <input id="rippleBy" v-model="rippleBy" type="number" step="0.5" aria-label="Ripple seconds"> s
            <button id="btnRipple" @click="ripple">Apply</button>
          </div>
        </section>
        </details>
      </aside>
    </template>
    <template #preview>
      <section class="preview-pane" aria-label="Layout preview">
        <div class="preview-heading">
          <h2>Preview</h2><span class="chip">1920 × 1080</span>
        </div>
        <div class="preview-canvas">
          <Preview :state="previewState" :cur="cur" :headline-px="headlineFit.px" :pill-px="pillPx" :product-px="productPx"
            :clips="clips" :playing="playing" />
        </div>
        <div id="stats" class="statline">
          <span class="chip">{{ state.headlines.length }} headlines</span>
          <span class="chip">{{ state.chapters.length }} chapters</span>
          <span class="chip info">headline text ≈ {{ (headlineFit.px / TEXT_SCALE).toFixed(0) }} px{{ headlineFit.idx >= 0 ? ` (set by #${headlineFit.idx + 1})` : '' }}</span>
          <span v-if="shortCount" class="chip warn">{{ shortCount }} shorter than 3 s</span>
        </div>
        <div class="hint preview-hint">Preview is an approximation of the rendered video. <kbd>Space</kbd> play/pause · <kbd>,</kbd> <kbd>.</kbd> previous / next headline.</div>
      </section>
    </template>
  </EditorWorkspace>
  <TimelineDock :state="state" :duration="totalDuration" :cur="cur" :selected-id="selectedId" :playing="playing"
    :selected-chapter-id="selectedChapterId" :offset="offset" :clips="clips" @seek="seek" @toggle-play="play"
    @select-chapter="selectChapter" @select-headline="selectTimelineHeadline"
    @begin-edit="beginEdit" @move-headline="moveHeadline" @move-headline-end="moveHeadlineEnd" />
  <div id="toast" class="toast" :class="{ show: message }" role="status">{{ message }}</div>
</template>
