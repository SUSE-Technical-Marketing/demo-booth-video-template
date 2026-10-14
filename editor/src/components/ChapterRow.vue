<script setup>
import TimeInput from './TimeInput.vue';
import { CH_COLORS, fmt } from '../timing.js';

defineProps({
  chapter: { type: Object, required: true },
  title: { type: String, required: true },
  offset: { type: Number, required: true },
  duration: { type: Number, required: true },
  selected: { type: Boolean, default: false },
  playing: { type: Boolean, default: false },
  headlineCount: { type: Number, default: 0 },
  warningCount: { type: Number, default: 0 },
});
const emit = defineEmits(['begin-edit', 'update-time', 'commit-time', 'error', 'select',
  'delete', 'update-title']);
</script>

<template>
  <div class="crow" :class="{ sel: selected }" :data-chapter-id="chapter.id"
    :title="duration < 0 ? 'Chapter starts after the effective chapter end' : `Length ${fmt(duration)}`" @click="emit('select')">
    <TimeInput :model-value="chapter.t" :offset="offset" @click.stop @begin-edit="emit('select'); emit('begin-edit')"
      @update:model-value="emit('update-time', $event)" @commit="emit('commit-time')" @error="emit('error', $event)" />
    <div class="textcell">
      <div><span class="dot" :class="{ playing }" :title="playing ? 'Playing chapter' : ''"
          :style="{ background: CH_COLORS[(chapter.ch - 1) % 6] }"></span>
        <span class="chapter-number">{{ chapter.ch }}</span>
        <input class="chapter-title" :value="title" placeholder="Chapter title" :aria-label="`Chapter ${chapter.ch} title`"
          :data-chapter="chapter.ch" :title="title" @click.stop @focus="emit('select'); emit('begin-edit')"
          @input="emit('update-title', $event.target.value)">
      </div>
    </div>
    <div class="acts">
      <button class="chapter-count" :class="{ warn: warningCount || duration < 0 }"
        :aria-pressed="selected" :aria-label="`Edit chapter ${chapter.ch}: ${title}, ${headlineCount} headlines${warningCount ? `, ${warningCount} outside chapter` : ''}${duration < 0 ? ', starts after chapter end' : ''}`"
        :title="`${headlineCount} headlines${warningCount ? `; ${warningCount} outside chapter` : ''}`"
        @click.stop="emit('select')">{{ headlineCount }}<span v-if="warningCount || duration < 0" aria-hidden="true">!</span></button>
      <button class="icon ghost secondary-action" title="Delete chapter" aria-label="Delete chapter" @click.stop="emit('delete')">✕</button>
    </div>
  </div>
</template>
