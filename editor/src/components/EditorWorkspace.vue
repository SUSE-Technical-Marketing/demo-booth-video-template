<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';

const workspace = ref(null), availableWidth = ref(0), sidebarPercent = ref(30), dragging = ref(false);
const minPercent = computed(() => availableWidth.value > 0 ? Math.min(60, 300 / availableWidth.value * 100) : 30);
const actualPercent = computed(() => Math.max(minPercent.value, Math.min(60, sidebarPercent.value)));
const displayedPercent = computed(() => Math.round(actualPercent.value * 10) / 10);
let observer, dragStart;

function setPercent(percent) {
  sidebarPercent.value = Math.max(minPercent.value, Math.min(60, percent));
}
function startResize(event) {
  if (dragStart || event.button !== 0 || availableWidth.value <= 0) return;
  event.preventDefault();
  event.currentTarget.focus();
  event.currentTarget.setPointerCapture(event.pointerId);
  dragStart = { id: event.pointerId, x: event.clientX, percent: actualPercent.value };
  dragging.value = true;
}
function resize(event) {
  if (!dragStart || event.pointerId !== dragStart.id) return;
  setPercent(dragStart.percent + (event.clientX - dragStart.x) / availableWidth.value * 100);
}
function stopResize(event) {
  if (!dragStart || event.pointerId !== dragStart.id) return;
  dragStart = null;
  dragging.value = false;
}
function keyboardResize(event) {
  let percent;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    if (availableWidth.value <= 0) return;
    percent = actualPercent.value + (event.key === 'ArrowLeft' ? -1 : 1)
      * (event.shiftKey ? 50 : 10) / availableWidth.value * 100;
  } else if (event.key === 'Home') percent = minPercent.value;
  else if (event.key === 'End') percent = 60;
  else if (event.key === 'Enter') percent = 30;
  else return;
  event.preventDefault();
  event.stopPropagation();
  setPercent(percent);
}
onMounted(() => {
  observer = new ResizeObserver(([entry]) => { availableWidth.value = entry.contentRect.width; });
  observer.observe(workspace.value);
});
onUnmounted(() => observer?.disconnect());
</script>

<template>
  <main ref="workspace" class="workspace" :class="{ resizing: dragging }"
    :style="{ '--sidebar-width': `${sidebarPercent}%` }" aria-label="Editing workspace">
    <slot name="editor" />
    <div class="resize-handle" :class="{ dragging }" role="separator" tabindex="0"
      aria-label="Resize editing panel" aria-orientation="vertical" aria-controls="editor-panel"
      :aria-valuemin="Math.round(minPercent * 10) / 10" :aria-valuemax="60" :aria-valuenow="displayedPercent"
      :aria-valuetext="`${displayedPercent}% editing panel width`"
      title="Drag to resize. Arrow keys: 10 px; Shift: 50 px. Double-click or Enter to reset."
      @pointerdown="startResize" @pointermove="resize" @pointerup="stopResize"
      @pointercancel="stopResize" @lostpointercapture="stopResize" @keydown="keyboardResize"
      @dblclick="sidebarPercent = 30"><span></span></div>
    <slot name="preview" />
  </main>
</template>
