<script setup>
import DurationBadge from './DurationBadge.vue';
import TimeInput from './TimeInput.vue';

defineProps({
  headline: { type: Object, required: true },
  offset: { type: Number, required: true },
  selected: { type: Boolean, default: false },
  duration: { type: Number, default: null },
  setsTextSize: { type: Boolean, default: false },
  outside: { type: Boolean, default: false },
});
const emit = defineEmits(['begin-edit', 'update-time', 'commit-time', 'error', 'select',
  'update-text', 'add-after', 'set-playhead', 'delete']);
</script>

<template>
  <div class="row" :class="{ sel: selected }" :data-row-id="headline.id" @click="emit('select')">
    <div class="relative-time"><span aria-hidden="true">{{ headline.t < 0 ? '' : '+' }}</span>
      <TimeInput :model-value="headline.t" :offset="offset" relative aria-label="Time within chapter" @click.stop
        @begin-edit="emit('begin-edit')" @update:model-value="emit('update-time', $event)"
        @commit="emit('commit-time')" @error="emit('error', $event)" /></div>
    <div class="textcell">
      <input :value="headline.text" spellcheck="true" placeholder="Headline, *accent* words" aria-label="Headline text" @click.stop
        :title="`${setsTextSize ? 'Longest headline: sets the shared text size. ' : ''}Wrap words in *asterisks* for accents. Enter adds a headline below.`"
        @focus="emit('begin-edit')" @input="emit('update-text', $event.target.value)"
        @keydown.enter.prevent="emit('add-after')">
    </div>
    <div class="meta">
      <template v-if="duration != null">
        <DurationBadge :duration="duration" :warning="outside || duration < 3 || duration > 25"
          :title="duration < 3 ? 'Short: less than 3 seconds on screen.' : duration > 25 ? 'Long: more than 25 seconds on screen.' : 'Time on screen, capped at this chapter end.'" />
      </template>
    </div>
    <div class="acts">
      <button class="icon ghost" title="Preview headline" aria-label="Preview headline" @click.stop="emit('select')">&#9654;</button>
      <button class="icon ghost secondary-action" title="Set time to the playhead" aria-label="Set time to the playhead" @click.stop="emit('set-playhead')">⏱</button>
      <button class="icon ghost secondary-action" title="Delete" aria-label="Delete headline" @click.stop="emit('delete')">✕</button>
    </div>
    <p v-if="outside" class="headline-error">Outside chapter — adjust this time or the chapter boundary.</p>
  </div>
</template>
