<script setup>
import { onUnmounted, ref } from 'vue';

const dialog = ref(null), projects = ref([]), selected = ref(0), isOpen = ref(false);
let complete;
function finish(project = null) {
  dialog.value.close();
  isOpen.value = false;
  complete?.(project);
  complete = null;
}
function choose(choices) {
  projects.value = choices;
  selected.value = 0;
  return new Promise((resolve, reject) => {
    complete = resolve;
    try {
      dialog.value.showModal();
      isOpen.value = true;
    } catch (error) {
      complete = null;
      reject(error);
    }
  });
}
onUnmounted(() => complete?.(null));
defineExpose({ choose, isOpen });
</script>

<template>
  <dialog ref="dialog" class="project-picker" aria-labelledby="project-picker-title" @cancel.prevent="finish()">
    <h2 id="project-picker-title">Choose a project</h2>
    <p>This source contains more than one JSON file.</p>
    <form @submit.prevent="finish(projects[selected])">
      <label>Project JSON
        <select v-model="selected" autofocus>
          <option v-for="(project, index) in projects" :key="project.name" :value="index">{{ project.name }}</option>
        </select>
      </label>
      <div class="project-picker-actions">
        <button type="button" class="ghost" @click="finish()">Cancel</button>
        <button type="submit" class="primary">Open project</button>
      </div>
    </form>
  </dialog>
</template>
