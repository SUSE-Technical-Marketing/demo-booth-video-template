<script setup>
import { ref, watch } from 'vue';
import { fmt, parseClock, parseTime, tc } from '../timing.js';

const props = defineProps({
  modelValue: { type: Number, required: true },
  offset: { type: Number, required: true },
  relative: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue', 'begin-edit', 'commit', 'error']);
const format = time => time < 0 ? `-${fmt(-time)}` : fmt(time);
const value = ref(format(props.modelValue));
watch(() => props.modelValue, time => { value.value = format(time); });
function commit() {
  const time = props.relative && value.value.trim().split(':').length === 3 ?
    parseClock(value.value) - props.offset : parseTime(value.value, props.offset);
  if (!Number.isFinite(time)) {
    value.value = format(props.modelValue);
    emit('error', 'Enter a valid time, such as 3:44, 224 or 1:03:44');
    return;
  }
  emit('update:modelValue', time);
  emit('commit');
  value.value = format(time);
}
function keydown(event) {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    const step = event.shiftKey ? 5 : event.altKey ? 0.1 : 1;
    const time = Math.max(0, +(props.modelValue + (event.key === 'ArrowUp' ? step : -step)).toFixed(2));
    value.value = fmt(time);
    emit('update:modelValue', time);
  } else if (event.key === 'Enter') event.target.blur();
}
</script>

<template>
  <input v-model="value" class="time" :title="tc(modelValue, offset)" aria-label="Time"
    @focus="emit('begin-edit'); $event.target.select()" @change="commit" @keydown="keydown" @blur="emit('commit')">
</template>
