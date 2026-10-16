<script setup>
import { computed } from 'vue';
import { headlineRuns } from '../timing.js';

const props = defineProps({ text: { type: String, default: '' } });
const runs = computed(() => headlineRuns(props.text));
</script>

<template>
  <template v-for="(run, i) in runs" :key="i"><b v-if="run.accent">{{ run.text }}</b><template v-else>{{ run.text }}</template></template>
</template>
