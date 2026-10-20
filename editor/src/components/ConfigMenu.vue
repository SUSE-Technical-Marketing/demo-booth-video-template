<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const open = defineModel('open', { type: Boolean, default: false });
defineProps({ label: { type: String, default: 'Project settings' } });
const root = ref(null), button = ref(null), menu = ref(null);

async function toggle() {
  open.value = !open.value;
  if (open.value) {
    await nextTick();
    menu.value?.focus();
  }
}
function close(returnFocus = false) {
  open.value = false;
  if (returnFocus) button.value?.focus();
}
// Stays open while you change values; closes on Esc, the gear or a click anywhere outside it.
const outside = event => { if (open.value && !root.value?.contains(event.target)) close(); };
onMounted(() => document.addEventListener('pointerdown', outside));
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside));
</script>

<template>
  <div ref="root" class="config">
    <button ref="button" class="config-button" type="button" aria-haspopup="dialog" :aria-expanded="open"
      aria-controls="config-menu" :aria-label="label" :title="`${label}: theme, title, headlines, render output, ripple`"
      @click="toggle">⚙</button>
    <div v-show="open" id="config-menu" ref="menu" class="config-menu" role="dialog" :aria-label="label" tabindex="-1"
      @keydown.esc.stop="close(true)">
      <div class="config-menu-heading">
        <h2>{{ label }}</h2>
        <button class="icon ghost" type="button" aria-label="Close settings" @click="close(true)">✕</button>
      </div>
      <slot />
    </div>
  </div>
</template>
