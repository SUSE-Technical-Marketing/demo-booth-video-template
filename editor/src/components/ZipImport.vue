<script setup>
import { onUnmounted, ref, watch } from 'vue';

const props = defineProps({ openProject: { type: Function, required: true } });
const emit = defineEmits(['error']);
const dialog = ref(null), isOpen = ref(false), busy = ref(false), mode = ref('file');
const file = ref(null), url = ref(''), errorText = ref(''), progress = ref(null);
const fileInput = ref(null);
watch(mode, () => { file.value = null; });
let controller;
const bytes = value => `${(value / 1048576).toFixed(1)} MB`;
function show() {
  if (!busy.value) {
    file.value = null;
    url.value = '';
    mode.value = 'file';
    if (fileInput.value) fileInput.value.value = '';
  }
  errorText.value = '';
  progress.value = null;
  try { dialog.value.showModal(); isOpen.value = true; }
  catch (error) { emit('error', error); }
}
function close() {
  controller?.abort();
  dialog.value.close();
  isOpen.value = false;
}
async function submit() {
  if (busy.value) return;
  const input = mode.value === 'file' ? file.value : url.value.trim();
  if (!input) { errorText.value = 'Choose a ZIP file or enter a ZIP URL'; return; }
  controller = new AbortController();
  busy.value = true;
  errorText.value = '';
  try {
    const opened = await props.openProject(input, {
      signal: controller.signal, onProgress: value => { progress.value = value; },
    });
    if (opened) { dialog.value.close(); isOpen.value = false; }
  } catch (error) {
    if (error.name !== 'AbortError' || !controller.signal.aborted) {
      errorText.value = error.message;
      emit('error', error);
    }
  } finally { busy.value = false; controller = null; }
}
onUnmounted(() => controller?.abort());
defineExpose({ show, isOpen });
</script>

<template>
  <dialog ref="dialog" class="zip-import" aria-labelledby="zip-import-title" @cancel.prevent="close">
    <h2 id="zip-import-title">Open ZIP project</h2>
    <p class="hint">Include a project JSON and its media, at the archive root or inside a folder.
      Files are extracted to browser-backed storage, not kept as a complete archive in memory.</p>
    <form @submit.prevent="submit">
      <fieldset :disabled="busy">
        <legend>Source</legend>
        <div class="tools">
          <label><input v-model="mode" type="radio" value="file"> Local ZIP</label>
          <label><input v-model="mode" type="radio" value="url"> ZIP URL</label>
        </div>
        <label v-if="mode === 'file'" class="zip-input">ZIP file
          <input id="zipFile" ref="fileInput" type="file" accept=".zip,application/zip" @change="file = $event.target.files[0]">
        </label>
        <label v-else class="zip-input">ZIP URL
          <input id="zipUrl" v-model="url" type="url" placeholder="https://example.com/project.zip" required>
        </label>
      </fieldset>
      <p class="hint">URL imports require a direct download link and a host that permits CORS. Private Drive share pages
        are not supported. URL downloads need temporary space for the ZIP as well as extracted files.</p>
      <div v-if="busy" class="zip-progress" role="status" aria-live="polite">
        <b>{{ progress?.phase || 'Preparing browser storage' }}</b>
        <progress :value="progress?.total ? progress.bytes : undefined" :max="progress?.total || 1"></progress>
        <span v-if="progress?.bytes != null">{{ bytes(progress.bytes) }}<template v-if="progress.total"> / {{ bytes(progress.total) }}</template></span>
        <span v-if="progress?.file" class="hint">{{ progress.file }}</span>
      </div>
      <p v-if="errorText" class="zip-error" role="alert">{{ errorText }}</p>
      <p class="hint">Imported projects use Download / Save as for edits; the original ZIP or URL is not updated.
        Temporary files are removed when you open another project. Browser storage is not a backup.</p>
      <div class="project-picker-actions">
        <button type="button" class="ghost" @click="close">{{ busy ? 'Cancel import' : 'Cancel' }}</button>
        <button id="btnImportZip" type="submit" class="primary" :disabled="busy">{{ busy ? 'Opening…' : 'Open project' }}</button>
      </div>
    </form>
  </dialog>
</template>
