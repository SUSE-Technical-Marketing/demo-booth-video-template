<script setup>
import { fmt } from '../timing.js';

defineProps({
  duration: { type: Number, required: true },
  warning: { type: Boolean, default: false },
  title: { type: String, default: 'Duration of this segment.' },
});
</script>

<template>
  <span class="chip duration-badge" :class="{ warn: warning || duration < 0 }"
    :title="duration < 0 ? 'This segment starts after its end.' : title">
    {{ duration < 0 ? 'Past end' : `Length ${fmt(duration)}` }}
  </span>
</template>
