<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import ChapterEditor from './components/ChapterEditor.vue';
import EditorWorkspace from './components/EditorWorkspace.vue';
import PreviewPlayer from './components/PreviewPlayer.vue';
import ProjectFilePicker from './components/ProjectFilePicker.vue';
import ShortcutHelp from './components/ShortcutHelp.vue';
import ProjectSettings from './components/ProjectSettings.vue';
import TabGroup from './components/TabGroup.vue';
import TimelineDock from './components/TimelineDock.vue';
import VideoList from './components/VideoList.vue';
import { downloadJSON, pickerOptions, rememberHandle, rememberedHandle } from './fileAccess.js';
import { clipEnd, loadClip, releaseClip } from './videos.js';
import { DEFAULT_RESOLUTION, createProject, fromProject, mediaPathForFile, mediaPathValid, normalizeMediaFolder,
  projectFPS, projectResolution, resolveMediaPath, toProjectJSON, validateProject } from './project.js';
import { directoryProjectSource, uploadedProjectSource } from './projectFiles.js';
import { fitWrappedPx, themeLayout } from './themes.js';
import { activeChapter, DEFAULT, duration, fitPx, fmt, headlineChapter, headlineEnd,
  headlineOutside, headlineTime, newRow, parseClock,
  parseTime, plain, removeChapter, sortAll, tc, TEXT_SCALE } from './timing.js';

const state = ref(createProject(DEFAULT));
const handle = shallowRef(null), reconnectHandle = shallowRef(null);
const openedName = ref(null);
const projectFolder = shallowRef(null), reconnectFolder = shallowRef(null), openingFolder = ref(false);
const dirty = ref(false), saving = ref(false), autosave = ref(true);
const cur = ref(0), selectedId = ref(null), playing = ref(false);
const presenting = ref(false), buffering = ref(false);
const editorTab = ref('chapters');
const editorTabs = [
  { id: 'chapters', label: 'Chapters & headlines' },
  { id: 'settings', label: 'Videos & settings' },
];
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
const fileInput = ref(null), chapterEditor = ref(null), previewPlayer = ref(null);
const folderInput = ref(null), projectPicker = ref(null);
const shortcutHelp = ref(null);
const mediaFiles = shallowRef(new Map());
const clips = computed(() => state.value.clips.map(clip => {
  const media = state.value.media.find(m => m.id === clip.media_id), file = mediaFiles.value.get(clip.media_id);
  return { ...clip, name: media.path.split('/').at(-1), path: media.path,
    resolvedPath: resolveMediaPath(media.path, state.value.media_folder),
    url: file?.url, sourceDuration: file?.dur, dur: clip.source_out - clip.source_in };
}));
const history = [];
let timer, saveTimer, toastTimer, lastTimestamp = 0, revision = 0, mounted = false, documentGeneration = 0;
const context = document.createElement('canvas').getContext('2d');
const totalDuration = computed(() => clips.value.length ? Math.max(...clips.value.map(clipEnd)) : duration(state.value));
watch(totalDuration, end => {
  if (cur.value > end) seek(end);
});
const previewState = computed(() => ({ ...state.value, preview_end: totalDuration.value }));
const status = computed(() => dirty.value
  ? (handle.value ? 'unsaved changes…' : 'unsaved (not linked to a file)')
  : (handle.value ? `saved to ${handle.value.name}` : openedName.value
    ? `opened ${openedName.value} (use Download to save)` : 'sample project: open a project JSON or add videos'));
function measure(text, px) {
  fontsVersion.value;
  context.font = `500 ${px}px SUSE, system-ui, sans-serif`;
  return context.measureText(text).width;
}
const headlineFit = computed(() => {
  const design = themeLayout(state.value.output.theme);
  let best = { w: 1, idx: -1 };
  state.value.headlines.forEach((h, idx) => {
    const w = measure(plain(h.text), design.HEADLINE_PX);
    if (w > best.w) best = { w, idx };
  });
  return { px: fitPx(best.w, design.HEADLINE_PX, design.HEADLINE_MAX_W), idx: best.idx };
});
const pillPx = computed(() => {
  const design = themeLayout(state.value.output.theme);
  return design.PILL_LINES > 1
    ? fitWrappedPx(state.value.chapters, design.PILL_TEXT_PX * TEXT_SCALE, design.PILL_TEXT_MAX_W, design.PILL_LINES, measure)
    : fitPx(Math.max(...state.value.chapters.map(c => measure(c, design.PILL_TEXT_PX))),
      design.PILL_TEXT_PX, design.PILL_TEXT_MAX_W);
});
const productPx = computed(() => {
  const design = themeLayout(state.value.output.theme);
  return fitPx(measure(state.value.product_name || ' ', design.PRODUCT_PX), design.PRODUCT_PX, design.PRODUCT_MAX_W);
});
const shortCount = computed(() => state.value.headlines.filter(h => !headlineOutside(state.value, h, totalDuration.value) &&
  headlineEnd(state.value, h, totalDuration.value) - headlineTime(state.value, h) < 3).length);

async function addVideos(files) {
  stop();
  const generation = documentGeneration;
  let added = 0;
  for (const file of files) {
    try {
      const path = mediaPathForFile(file);
      const loaded = await loadClip(file, 0);
      if (generation !== documentGeneration) {
        releaseClip(loaded);
        return toast('Project changed; stopped adding videos');
      }
      if (!added) pushHistory();
      const mediaId = crypto.randomUUID(), clipId = crypto.randomUUID();
      state.value.media.push({ id: mediaId, path });
      state.value.clips.push({ id: clipId, media_id: mediaId,
        start: clips.value.length ? Math.max(...clips.value.map(clipEnd)) : 0, source_in: 0, source_out: loaded.dur });
      mediaFiles.value = new Map(mediaFiles.value).set(mediaId, loaded);
      markDirty();
      added++;
    } catch (error) { toast(error.message); }
  }
  if (added) toast(`Added ${added} ${added > 1 ? 'videos' : 'video'}`);
}
function updateClipStart(clip, time) {
  updateClip(clip, { start: time });
}
function updateClip(clip, patch, recordHistory = true) {
  const next = state.value.clips.map(c => c.id === clip.id ? { ...c, ...patch } : c);
  try {
    const changed = next.find(c => c.id === clip.id), source = mediaFiles.value.get(clip.media_id);
    if (source && changed.source_out > source.dur + 1e-6) throw new Error('Source out exceeds the video duration');
    validateProject({ project_version: 1, ...state.value, clips: next, timing: { schema_version: 2 } });
  } catch (error) { return toast(error.message); }
  if (recordHistory) pushHistory();
  state.value.clips = next.sort((a, b) => a.start - b.start);
  markDirty();
  return true;
}
function trimClip(clip, patch, time) {
  if (!updateClip(clip, patch, false)) return;
  editorTab.value = 'settings';
  seek(time);
}
function updateMediaFolder(value) {
  let folder;
  try { folder = normalizeMediaFolder(value); }
  catch (error) { return toast(error.message); }
  if (folder === (state.value.media_folder ?? '')) return;
  pushHistory();
  state.value.media_folder = folder;
  markDirty();
}
function updateMediaPath(clip, path) {
  if (!mediaPathValid(path)) return toast('Use a relative media path with forward slashes');
  pushHistory();
  state.value.media.find(m => m.id === clip.media_id).path = path;
  markDirty();
}
async function relinkMedia(clip, file) {
  const generation = documentGeneration;
  try {
    const loaded = await loadClip(file, 0);
    if (generation !== documentGeneration) {
      releaseClip(loaded);
      return toast('Project changed; media was not linked');
    }
    if (state.value.clips.some(c => c.media_id === clip.media_id && c.source_out > loaded.dur + 1e-6)) {
      releaseClip(loaded);
      return toast('Selected video is shorter than the saved source out point');
    }
    const previous = mediaFiles.value.get(clip.media_id);
    if (previous) releaseClip(previous);
    mediaFiles.value = new Map(mediaFiles.value).set(clip.media_id, loaded);
    toast('Linked ' + file.name);
  } catch (error) { toast(error.message); }
}
function updateFPS(value) {
  try {
    projectFPS(value);
    validateProject({ project_version: 1, ...state.value, output: { ...state.value.output, fps: value }, timing: { schema_version: 2 } });
  }
  catch (error) { return toast(error.message); }
  pushHistory();
  state.value.output.fps = value;
  markDirty();
}
function updateResolution(value) {
  try { projectResolution(value); }
  catch (error) { return toast(error.message); }
  if (value === (state.value.output.resolution ?? DEFAULT_RESOLUTION)) return;
  pushHistory();
  state.value.output.resolution = value;
  markDirty();
}
function updateTheme(value) {
  try { themeLayout(value); }
  catch (error) { return toast(error.message); }
  if (value === (state.value.output.theme ?? 'classic')) return;
  pushHistory();
  state.value.output.theme = value;
  markDirty();
}
function removeClip(clip) {
  pushHistory();
  state.value.clips = state.value.clips.filter(c => c.id !== clip.id);
  markDirty();
}
function clearClips() {
  mediaFiles.value.forEach(releaseClip);
  mediaFiles.value = new Map();
}
async function newVideo() {
  if (dirty.value && !window.confirm('You have unsaved changes. Start a new video anyway?')) return;
  loadState(createProject({
    title: 'New video', product_name: '', chapters: ['Chapter 1'], chapter_starts: [[0, 1]],
    headlines: [[0, 'Your first *headline*']], headlines_end: null, wipe_seconds: 0.8,
  }), null);
  editorTab.value = 'chapters';
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
  editorTab.value = 'chapters';
  const chapter = state.value.chapter_starts.find(c => c.id === h.chapterId);
  h.t = +(time - chapter.t).toFixed(2);
  selectedChapterId.value = chapter.id;
  selectedId.value = h.id;
  setCur(time);
  markDirty();
}
function moveChapter(chapter, time) {  // its headlines are relative to it, so they move with it
  editorTab.value = 'chapters';
  chapter.t = time;
  selectedChapterId.value = chapter.id;
  selectedId.value = null;
  setCur(time + 0.1);
  markDirty();
}
function moveHeadlineEnd(h, time) {    // time = null puts the end back to automatic
  editorTab.value = 'chapters';
  const chapter = state.value.chapter_starts.find(c => c.id === h.chapterId);
  h.end = time == null ? null : +(time - chapter.t).toFixed(2);
  selectedChapterId.value = chapter.id;
  selectedId.value = h.id;
  setCur(Math.max(headlineTime(state.value, h), (time ?? headlineEnd(state.value, h, totalDuration.value)) - 0.5));
  markDirty();
}
function selectChapter(chapter) {
  editorTab.value = 'chapters';
  followPlayhead.value = false;
  selectedChapterId.value = chapter.id;
  selectedId.value = null;
}
async function selectTimelineHeadline(h) {
  editorTab.value = 'chapters';
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
function present(active) {
  stop();
  presenting.value = active;
  buffering.value = false;
  if (active) {
    followPlayhead.value = false;
    cur.value = 0;
    play();
  }
}
function playbackError(error) {
  stop();
  report('Playback failed', error);
}
function play() {
  if (playing.value) return stop();
  if (cur.value >= totalDuration.value - (presenting.value ? 0 : 1)) cur.value = 0;
  playing.value = true;
  lastTimestamp = performance.now();
  const tick = timestamp => {
    if (!playing.value) return;
    const next = cur.value + (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;
    if (!presenting.value || !buffering.value) {
      cur.value = presenting.value ? next % totalDuration.value : Math.min(totalDuration.value, next);
    }
    if (!presenting.value && cur.value >= totalDuration.value) return stop();
    timer = requestAnimationFrame(tick);
  };
  timer = requestAnimationFrame(tick);
}
function activateHeadline(h) {
  editorTab.value = 'chapters';
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
async function remember(fileHandle, folder = null) {
  try { await rememberHandle(folder?.directory ? { file: fileHandle, directory: folder.directory } : fileHandle); }
  catch (error) { report('Could not remember project access', error); }
}
function loadState(next, fileHandle, notice = '', folder = null, name = fileHandle?.name ?? null) {
  clearTimeout(saveTimer);
  stop();
  pushHistory();
  documentGeneration++;
  clearClips();
  state.value = next;
  handle.value = fileHandle;
  openedName.value = name;
  projectFolder.value = folder;
  reconnectHandle.value = null;
  reconnectFolder.value = null;
  dirty.value = Boolean(notice);
  selectedId.value = null;
  selectedChapterId.value = next.chapter_starts[0].id;
  followPlayhead.value = false;
  revision++;
}
function readTiming(text) {
  const source = JSON.parse(text);
  return { next: fromProject(source), notice: '' };
}
function documentGuard() {
  const generation = documentGeneration, initialRevision = revision;
  return () => mounted && generation === documentGeneration && initialRevision === revision;
}
async function installProject(next, fileHandle, notice, folder, isCurrent, name = fileHandle?.name ?? null) {
  let files = new Map();
  const issues = [], used = new Set(next.clips.map(clip => clip.media_id));
  try {
    if (folder) {
      for (const media of next.media.filter(media => used.has(media.id))) {
        if (!isCurrent()) throw new Error('Project changed while opening; open the folder again');
        const path = resolveMediaPath(media.path, next.media_folder);
        let loaded;
        try {
          loaded = await loadClip(await folder.media(path), 0);
          if (next.clips.some(clip => clip.media_id === media.id && clip.source_out > loaded.dur + 1e-6)) {
            throw new Error('Video is shorter than the saved source out point');
          }
          files.set(media.id, loaded);
        } catch (error) {
          if (loaded) releaseClip(loaded);
          console.warn('Could not link media', path, error);
          issues.push(`${path}: ${error.message}`);
        }
      }
    }
    if (!isCurrent()) throw new Error('Project changed while opening; try again');
    loadState(next, fileHandle, notice, folder, name);
    mediaFiles.value = files;
    files = null;
    return [notice, ...issues].filter(Boolean).join('; ');
  } finally {
    files?.forEach(releaseClip);
  }
}
async function loadFromHandle(fileHandle, folder = null, isCurrent = documentGuard()) {
  const { next, notice } = readTiming(await (await fileHandle.getFile()).text());
  return installProject(next, fileHandle, notice, folder, isCurrent);
}
async function openFolderSource(source, isCurrent) {
  const choices = await source.projects();
  if (!isCurrent()) throw new Error('Project changed while choosing a folder; try again');
  if (!choices.length) throw new Error('No project JSON found directly in this folder; select the folder containing your project JSON');
  const project = choices.length === 1 ? choices[0] : await projectPicker.value.choose(choices);
  if (!project) return;
  const { next, notice } = readTiming(await (await project.getFile()).text());
  const issues = await installProject(next, project.handle, notice, source, isCurrent, project.name);
  toast(`Opened ${project.name}; linked ${mediaFiles.value.size} video source(s)${project.handle ? '' : '; use Download to save'}`, issues);
  await remember(project.handle, source);
}
async function openProjectFolder() {
  if (saving.value) return toast('Wait for the current save to finish');
  if (!window.showDirectoryPicker) return folderInput.value.click();
  const isCurrent = documentGuard();
  openingFolder.value = true;
  try {
    const directory = await window.showDirectoryPicker({ id: 'video-project', mode: 'readwrite' });
    await openFolderSource(directoryProjectSource(directory), isCurrent);
  } catch (error) { report('Open folder failed', error); }
  finally { openingFolder.value = false; }
}
async function importProjectFolder(event) {
  const files = [...event.target.files];
  if (!files.length) return;
  const isCurrent = documentGuard();
  openingFolder.value = true;
  try { await openFolderSource(uploadedProjectSource(files), isCurrent); }
  catch (error) { report('Open folder failed', error); }
  finally {
    event.target.value = '';
    openingFolder.value = false;
  }
}
async function openFile() {
  if (saving.value) return toast('Wait for the current save to finish');
  if (!window.showOpenFilePicker) return fileInput.value.click();
  const isCurrent = documentGuard();
  try {
    const [fileHandle] = await window.showOpenFilePicker(pickerOptions);
    const notice = await loadFromHandle(fileHandle, null, isCurrent);
    toast('Opened ' + fileHandle.name, notice);
    await remember(fileHandle);
  } catch (error) { report('Open failed', error); }
}
async function importFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const { next, notice } = readTiming(await file.text());
    loadState(next, null, notice, null, file.name);
    toast(`Opened ${file.name}; use Download to save changes in this browser`, notice);
  } catch (error) { report('Open failed', error); }
  finally { event.target.value = ''; }
}
function checkedJSON() {
  return toProjectJSON(state.value);
}
function download() {
  try {
    downloadJSON(checkedJSON());
    toast('Downloaded project.json');
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
      target = await window.showSaveFilePicker({ ...pickerOptions, suggestedName: handle.value?.name ?? 'project.json' });
    }
    const folder = target === handle.value || (projectFolder.value?.directory &&
      (await projectFolder.value.directory.resolve(target))?.length === 1) ? projectFolder.value : null;
    const writable = await target.createWritable();
    await writable.write(text);
    await writable.close();
    if (target !== handle.value) {
      handle.value = target;
      projectFolder.value = folder;
      reconnectHandle.value = null;
      reconnectFolder.value = null;
      await remember(target, folder);
    }
    if (revision === savedRevision) dirty.value = false;
    else scheduleSave();
    toast('Saved ' + target.name);
  } catch (error) { report('Save failed', error); }
  finally { saving.value = false; }
}
async function reconnect() {
  const isCurrent = documentGuard();
  try {
    const fileHandle = reconnectHandle.value, folder = reconnectFolder.value;
    if (folder && await folder.directory.requestPermission({ mode: 'readwrite' }) !== 'granted') {
      return toast('Project folder access was not granted');
    }
    if (await fileHandle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
      return toast('File access was not granted');
    }
    const notice = await loadFromHandle(fileHandle, folder, isCurrent);
    toast('Loaded ' + fileHandle.name, notice);
  } catch (error) { report('Reconnect failed', error); }
}
async function connectRemembered() {
  const initialRevision = revision;
  const isCurrent = documentGuard();
  try {
    const remembered = await rememberedHandle(), fileHandle = remembered?.file ?? remembered;
    const folder = remembered?.directory ? directoryProjectSource(remembered.directory) : null;
    if (!fileHandle || !fileHandle.queryPermission || !mounted || revision !== initialRevision) return;
    const fileGranted = await fileHandle.queryPermission({ mode: 'readwrite' }) === 'granted';
    const folderGranted = !folder || await folder.directory.queryPermission({ mode: 'read' }) === 'granted';
    if (fileGranted && folderGranted) {
      const { next, notice } = readTiming(await (await fileHandle.getFile()).text());
      if (isCurrent()) {
        const issues = await installProject(next, fileHandle, notice, folder, isCurrent);
        toast('Loaded ' + fileHandle.name, issues);
      }
    } else if (isCurrent()) {
      reconnectHandle.value = fileHandle;
      reconnectFolder.value = folder;
    }
  } catch (error) { report('Could not reconnect the remembered file', error); }
}
async function refreshFile() {
  const fileHandle = handle.value, initialRevision = revision;
  const isCurrent = documentGuard(), folder = projectFolder.value;
  if (!fileHandle || dirty.value || saving.value || presenting.value) return;
  try {
    if (await fileHandle.queryPermission({ mode: 'read' }) !== 'granted') return;
    const { next, notice } = readTiming(await (await fileHandle.getFile()).text());
    if (mounted && !presenting.value && !dirty.value && revision === initialRevision && handle.value === fileHandle &&
        (notice || toProjectJSON(next) !== toProjectJSON(state.value))) {
      const issues = await installProject(next, fileHandle, notice, folder,
        () => isCurrent() && !presenting.value && !dirty.value && handle.value === fileHandle);
      toast('Updated from file', issues);
    }
  } catch (error) { report('Could not refresh the linked file', error); }
}
function keydown(event) {
  const target = document.activeElement;
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable ||
    !!target.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]');
  if (!typing && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey && event.key === '?') {
    event.preventDefault();
    if (!event.repeat) shortcutHelp.value.toggle();
    return;
  }
  if (shortcutHelp.value?.isOpen || projectPicker.value?.isOpen) return;
  if (presenting.value) {
    if (event.code === 'Space' && !target.closest('button')) {
      event.preventDefault();
      play();
    }
    return;
  }
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
  documentGeneration++;
  clearClips();
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
    <button id="btnOpen" title="Open a project JSON file" @click="openFile">Open file…</button>
    <button id="btnOpenFolder" :disabled="openingFolder" title="Open a folder containing project JSON and media, linking videos automatically"
      @click="openProjectFolder">{{ openingFolder ? 'Opening folder…' : 'Open project folder…' }}</button>
    <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="importFile">
    <input ref="folderInput" id="projectFolderInput" type="file" webkitdirectory multiple hidden @change="importProjectFolder">
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
    <button id="btnPresent" class="present" :disabled="!previewPlayer || previewPlayer.entering"
      :title="previewPlayer?.unavailable || 'Play the full composition fullscreen in a muted loop'"
      @click="previewPlayer.enterFullscreen()">{{ previewPlayer?.entering ? 'Opening…' : 'Play fullscreen loop' }}</button>
    <button id="btnShortcuts" class="ghost" aria-label="Keyboard shortcuts" aria-haspopup="dialog" aria-keyshortcuts="?"
      title="Keyboard shortcuts (?)" @click="shortcutHelp.toggle()">?</button>
    <a href="https://github.com/SUSE-Technical-Marketing/demo-booth-video-template#readme" target="_blank" rel="noopener" class="help">Help</a>
  </header>

  <EditorWorkspace>
    <template #editor>
      <aside id="editor-panel" class="editor-panel" aria-label="Project editor" tabindex="0">
        <TabGroup v-model="editorTab" :tabs="editorTabs" label="Editor sections">
          <template #chapters>
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
          </template>
          <template #settings>
            <div class="project-settings">
              <VideoList :clips="clips" :starts="state.chapter_starts" :media-folder="state.media_folder"
                @update-folder="updateMediaFolder" @add="addVideos" @update-start="updateClipStart"
                @update-clip="updateClip" @update-path="updateMediaPath" @relink="relinkMedia"
                @remove="removeClip" @error="toast" />
              <ProjectSettings :title="state.title" :product-name="state.product_name"
                :headline-end="state.headlines_end" :wipe-seconds="state.wipe_seconds" :cur="cur"
                :fps="state.output.fps" @update-fps="updateFPS"
                :resolution="state.output.resolution" @update-resolution="updateResolution"
                :theme="state.output.theme" @update-theme="updateTheme"
                v-model:ripple-by="rippleBy" @begin-edit="beginEdit" @update-metadata="updateMetadata"
                @change-end="updateEnd" @change-wipe="updateWipe" @ripple="ripple" />
            </div>
          </template>
        </TabGroup>
      </aside>
    </template>
    <template #preview>
      <section class="preview-pane" aria-label="Layout preview">
        <PreviewPlayer ref="previewPlayer" :state="previewState" :cur="cur" :headline-px="headlineFit.px" :pill-px="pillPx" :product-px="productPx"
          :clips="clips" :playing="playing" @present="present" @toggle-play="play" @playback-error="playbackError"
          @buffering="buffering = $event" />
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
    @begin-edit="beginEdit" @move-headline="moveHeadline" @move-headline-end="moveHeadlineEnd" @move-chapter="moveChapter"
    @trim-clip="trimClip" />
  <div id="toast" class="toast" :class="{ show: message }" role="status">{{ message }}</div>
  <ShortcutHelp ref="shortcutHelp" @error="toast" />
  <ProjectFilePicker ref="projectPicker" />
</template>
