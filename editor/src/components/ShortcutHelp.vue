<script setup>
import { ref } from 'vue';

const emit = defineEmits(['error']);
const dialog = ref(null), isOpen = ref(false);
const sections = [
  { title: 'Playback and help', shortcuts: [
    ['?', 'Show or hide keyboard shortcuts'],
    ['Space', 'Play / pause (outside text fields and focused buttons)'],
    [', / .', 'Previous / next headline (editor only)'],
    ['Esc', 'Close help; exit fullscreen when help is closed'],
  ] },
  { title: 'Project (editor only)', shortcuts: [
    ['Ctrl / Cmd + S', 'Save'],
    ['Ctrl / Cmd + Shift + S', 'Save as'],
    ['Ctrl / Cmd + Z', 'Undo; text fields keep their native text undo'],
  ] },
  { title: 'Editing (focus the relevant control)', shortcuts: [
    ['Up / Down', 'Chapter/headline time: nudge by 1 second'],
    ['Shift + Up / Down', 'Chapter/headline time: nudge by 5 seconds'],
    ['Alt + Up / Down', 'Chapter/headline time: nudge by 0.1 seconds'],
    ['Enter', 'Time field: commit; headline text: add a headline below'],
    ['Left / Right', 'Timeline handle: nudge by 0.1 seconds'],
    ['Shift + Left / Right', 'Timeline handle: nudge by 1 second'],
    ['Ctrl / Cmd + scroll', 'Zoom the timeline (trackpad pinch also works)'],
  ] },
  { title: 'Workspace navigation', shortcuts: [
    ['Tab / Shift + Tab', 'Focus the next / previous control'],
    ['Left / Right', 'Sidebar tabs: switch tabs'],
    ['Home / End', 'Sidebar tabs: first / last tab'],
    ['Left / Right', 'Sidebar divider: resize by 10 pixels'],
    ['Shift + Left / Right', 'Sidebar divider: resize by 50 pixels'],
    ['Home / End', 'Sidebar divider: minimum / maximum width'],
    ['Enter', 'Sidebar divider: reset to 30% width'],
  ] },
];
function close() {
  dialog.value.close();
  isOpen.value = false;
}
function toggle() {
  if (isOpen.value) return close();
  try {
    dialog.value.showModal();
    isOpen.value = true;
  } catch (error) {
    emit('error', `Could not show keyboard shortcuts: ${error.message}`);
  }
}
function backdropClick(event) {
  if (event.target !== dialog.value) return;
  const rect = dialog.value.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
}
defineExpose({ toggle, isOpen });
</script>

<template>
  <dialog ref="dialog" class="shortcut-help" aria-labelledby="shortcut-help-title" aria-describedby="shortcut-help-note"
    @cancel.prevent="close" @close="isOpen = false" @click="backdropClick">
    <div class="shortcut-help-heading">
      <h2 id="shortcut-help-title">Keyboard shortcuts</h2>
      <button class="ghost" autofocus aria-label="Close keyboard shortcuts" @click="close">Close</button>
    </div>
    <p id="shortcut-help-note" class="hint">Press ? outside an editable field to open this help. Focus a control to use its specific shortcuts.</p>
    <section v-for="section in sections" :key="section.title">
      <h3>{{ section.title }}</h3>
      <dl>
        <template v-for="[keys, description] in section.shortcuts" :key="keys + description">
          <dt><kbd>{{ keys }}</kbd></dt>
          <dd>{{ description }}</dd>
        </template>
      </dl>
    </section>
  </dialog>
</template>
