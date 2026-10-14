<script setup>
import { computed } from 'vue';
import { headlineWords } from '../timing.js';

const props = defineProps({ text: { type: String, default: '' } });
const words = computed(() => headlineWords(props.text));
</script>

<template>
  <template v-for="(word, i) in words" :key="i">{{ i ? ' ' : '' }}<b v-if="word.accent">{{ word.text }}</b><template v-else>{{ word.text }}</template></template>
</template>
