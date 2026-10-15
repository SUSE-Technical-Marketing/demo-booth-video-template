<script setup>
import { fmt } from '../timing.js';

defineProps({
  title: { type: String, required: true },
  productName: { type: String, required: true },
  headlineEnd: { type: Number, default: null },
  wipeSeconds: { type: Number, required: true },
  cur: { type: Number, required: true },
});
const rippleBy = defineModel('rippleBy', { type: [Number, String], required: true });
const emit = defineEmits(['begin-edit', 'update-metadata', 'change-end', 'change-wipe', 'ripple']);
</script>

<template>
  <section class="card">
    <h2>Video title and product</h2>
    <div id="meta" class="names">
      <label class="inline">title <input id="titleIn" :value="title" placeholder="Video title (for your own reference)"
        @focus="emit('begin-edit')" @input="emit('update-metadata', 'title', $event.target.value)"></label>
      <label class="inline">product <input id="productIn" :value="productName" placeholder="Shown under the logo"
        @focus="emit('begin-edit')" @input="emit('update-metadata', 'product_name', $event.target.value)"></label>
    </div>
  </section>
  <section class="card">
    <h2>Headline settings</h2>
    <div class="tools">
      <label class="inline">headlines end at <input id="endAt" :value="headlineEnd == null ? '' : fmt(headlineEnd)"
        size="7" placeholder="video end" @change="emit('change-end', $event)"></label>
      <label class="inline">wipe <input id="wipe" :value="wipeSeconds" type="number"
        min="0" max="3" step="0.1" @change="emit('change-wipe', $event)"> s</label>
    </div>
  </section>
  <section class="card">
    <h2>Ripple <span class="heading-hint">cut dead space? slide everything after the playhead</span></h2>
    <div class="tools ripple-tools">
      <span>Shift all chapters &amp; headlines at or after <b id="rippleAt">{{ fmt(cur) }}</b> by</span>
      <input id="rippleBy" v-model="rippleBy" type="number" step="0.5" aria-label="Ripple seconds"> s
      <button id="btnRipple" @click="emit('ripple')">Apply</button>
    </div>
  </section>
</template>
