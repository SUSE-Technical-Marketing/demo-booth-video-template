<script setup>
import { computed, ref, watch } from 'vue';
import { fmt, parseClock } from '../timing.js';
import { MIN_FREEZE } from '../edits.js';

// The strip above the timeline for the two editing tools. It only collects choices; App applies them (and records
// the undo step). The cut range lives in App so the timeline can draw it and let you drag its edges.
const props = defineProps({
  tool: { type: String, required: true },            // 'freeze' | 'cut'
  cur: { type: Number, required: true },
  problem: { type: String, default: null },           // why a freeze cannot be made at the playhead
  frameName: { type: String, default: '' },           // the video the playhead is on
  cutRange: { type: Object, default: null },
});
const emit = defineEmits(['apply-freeze', 'apply-cut', 'update-cut', 'close', 'error']);

// remembered for the next time the tool is opened during this visit
const last = { length: 3, mode: 'insert', shift: true };
const length = ref(last.length), mode = ref(last.mode), shift = ref(last.shift);
watch([length, mode, shift], () => Object.assign(last, { length: length.value, mode: mode.value, shift: shift.value }));

const lengthOk = computed(() => Number.isFinite(+length.value) && +length.value >= MIN_FREEZE);
const span = computed(() => props.cutRange ? props.cutRange.end - props.cutRange.start : 0);

function commitTime(key, event) {
  const time = parseClock(event.target.value);
  event.target.value = fmt(props.cutRange[key]);
  if (!Number.isFinite(time)) return emit('error', 'Enter a valid time, such as 3:44');
  emit('update-cut', { [key]: +time.toFixed(2) });
  event.target.value = fmt(time);
}
const freeze = () => emit('apply-freeze', { length: +length.value, mode: mode.value, shift: mode.value === 'insert' && shift.value });
const cut = () => emit('apply-cut', { from: props.cutRange.start, to: props.cutRange.end, shift: shift.value });
</script>

<template>
  <div class="edit-strip" role="group" :aria-label="tool === 'freeze' ? 'Freeze frame' : 'Cut section'" @keydown.esc.stop="emit('close')">
    <template v-if="tool === 'freeze'">
      <strong class="strip-title">Freeze frame</strong>
      <span v-if="problem" id="freezeProblem" class="strip-problem">{{ problem }}</span>
      <template v-else>
        <span class="strip-at">at <b>{{ fmt(cur) }}</b> in {{ frameName }}</span>
        <label class="strip-field">Hold for
          <input id="freezeLength" v-model="length" type="number" min="0.1" step="0.5" class="time" aria-label="Freeze length in seconds"
            @keydown.enter="lengthOk && freeze()"> s</label>
        <div class="strip-modes" role="radiogroup" aria-label="What happens to the video">
          <label :class="{ on: mode === 'insert' }"><input v-model="mode" type="radio" value="insert" name="freezeMode">
            <span><b>Insert</b> pushes the rest of the video later</span></label>
          <label :class="{ on: mode === 'replace' }"><input v-model="mode" type="radio" value="replace" name="freezeMode">
            <span><b>Replace</b> covers the next {{ lengthOk ? fmt(+length) : '…' }} of video</span></label>
        </div>
        <label class="strip-check" :class="{ off: mode === 'replace' }"><input v-model="shift" type="checkbox" :disabled="mode === 'replace'">
          Move later chapters and headlines too</label>
      </template>
      <span class="spacer"></span>
      <button v-if="!problem" id="freezeApply" class="primary" :disabled="!lengthOk" @click="freeze">Freeze frame</button>
    </template>

    <template v-else>
      <strong class="strip-title">Cut section</strong>
      <label class="strip-field">From
        <input id="cutFrom" class="time" :value="fmt(cutRange.start)" aria-label="Cut from" @focus="$event.target.select()"
          @change="commitTime('start', $event)" @keydown.enter="$event.target.blur()">
        <button class="ghost" title="Use the playhead position" @click="emit('update-cut', { start: +cur.toFixed(2) })">playhead</button></label>
      <label class="strip-field">To
        <input id="cutTo" class="time" :value="fmt(cutRange.end)" aria-label="Cut to" @focus="$event.target.select()"
          @change="commitTime('end', $event)" @keydown.enter="$event.target.blur()">
        <button class="ghost" title="Use the playhead position" @click="emit('update-cut', { end: +cur.toFixed(2) })">playhead</button></label>
      <span id="cutSpan" class="strip-at">removes <b>{{ fmt(Math.max(0, span)) }}</b> and closes the gap</span>
      <label class="strip-check"><input v-model="shift" type="checkbox"> Move later chapters and headlines too</label>
      <span class="strip-hint">Drag the red edges on the timeline to adjust.</span>
      <span class="spacer"></span>
      <button id="cutApply" class="primary danger" :disabled="!(span > 0.01)" @click="cut">Delete section</button>
    </template>
    <button class="icon ghost strip-close" aria-label="Close this tool" title="Close (Esc)" @click="emit('close')">✕</button>
  </div>
</template>
