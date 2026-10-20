<script setup>
import { onMounted, ref, watch } from 'vue';

const open = defineModel('open', { type: Boolean, default: false });
defineProps({ label: { type: String, default: 'Project settings' } });
const emit = defineEmits(['error']);
const button = ref(null), menu = ref(null);

function toggle() {
  open.value = !open.value;
}
function close() {
  open.value = false;
}
function syncDialog() {
  if (open.value && !menu.value.open) {
    try {
      menu.value.showModal();
      menu.value.focus();
    } catch (error) {
      open.value = false;
      emit('error', `Could not show project settings: ${error.message}`);
    }
  } else if (!open.value && menu.value.open) {
    menu.value.close();
    button.value?.focus();
  }
}
function backdropClick(event) {
  if (event.target !== menu.value) return;
  const rect = menu.value.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
}
watch(open, syncDialog, { flush: 'post' });
onMounted(syncDialog);
</script>

<template>
  <div class="config">
    <button ref="button" class="config-button" type="button" aria-haspopup="dialog" :aria-expanded="open"
      aria-controls="config-menu" :aria-label="label" :title="`${label}: theme, title, headlines, render output, ripple`"
      @click="toggle">⚙</button>
    <dialog id="config-menu" ref="menu" class="config-menu" aria-modal="true" :aria-label="label" tabindex="-1"
      @keydown.stop @keydown.esc.prevent="close" @cancel.prevent="close" @close="close" @click="backdropClick">
      <div class="config-menu-heading">
        <h2>{{ label }}</h2>
        <button class="icon ghost" type="button" aria-label="Close settings" @click="close">✕</button>
      </div>
      <slot />
    </dialog>
  </div>
</template>
