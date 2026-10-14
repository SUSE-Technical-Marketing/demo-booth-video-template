<script setup>
import AccentText from './AccentText.vue';
import DurationBadge from './DurationBadge.vue';
import TimeInput from './TimeInput.vue';

defineProps({
  headline: { type: Object, required: true },
  offset: { type: Number, required: true },
  selected: { type: Boolean, default: false },
  duration: { type: Number, default: null },
  setsTextSize: { type: Boolean, default: false },
});
const emit = defineEmits(['begin-edit', 'update-time', 'commit-time', 'error', 'select',
  'update-text', 'add-after', 'set-playhead', 'delete']);
</script>

<template>
  <div class="row" :class="{ sel: selected }" :data-row-id="headline.id" @click="emit('select')">
    <TimeInput :model-value="headline.t" :offset="offset" @begin-edit="emit('begin-edit')"
      @update:model-value="emit('update-time', $event)" @commit="emit('commit-time')" @error="emit('error', $event)" />
    <div class="textcell">
      <input :value="headline.text" spellcheck="true" placeholder="Headline, *accent* words"
        @focus="emit('begin-edit')" @input="emit('update-text', $event.target.value)"
        @keydown.enter.prevent="emit('add-after')">
      <div class="mini"><AccentText :text="headline.text" /></div>
    </div>
    <div class="meta">
      <template v-if="duration != null">
        <DurationBadge :duration="duration" :warning="duration < 3"
          title="Time on screen until the next headline or headline end." />
        <span v-if="duration >= 0 && duration < 3" class="chip warn">short</span>
        <span v-if="duration > 25" class="chip warn">long</span>
      </template>
      <span v-if="setsTextSize" class="chip info" title="The longest headline sets the shared text size">sets text size</span>
    </div>
    <div class="acts">
      <button class="icon ghost" title="Set time to the playhead" @click.stop="emit('set-playhead')">⏱</button>
      <button class="icon ghost" title="Delete" @click.stop="emit('delete')">✕</button>
    </div>
  </div>
</template>
