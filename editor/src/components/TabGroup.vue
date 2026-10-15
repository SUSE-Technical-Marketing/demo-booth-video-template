<script setup>
import TabPane from './TabPane.vue';

const props = defineProps({
  tabs: { type: Array, required: true },
  label: { type: String, required: true },
});
const selected = defineModel({ type: String, required: true });

function switchTab(event, index) {
  let next;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = props.tabs.length - 1;
  else if (event.key === 'ArrowLeft') next = (index - 1 + props.tabs.length) % props.tabs.length;
  else if (event.key === 'ArrowRight') next = (index + 1) % props.tabs.length;
  else return;
  event.preventDefault();
  selected.value = props.tabs[next].id;
  event.currentTarget.parentElement.querySelectorAll('[role=tab]')[next].focus();
}
</script>

<template>
  <div class="tab-group">
    <div class="tab-list" role="tablist" :aria-label="label">
      <button v-for="(tab, index) in tabs" :key="tab.id" :id="`${tab.id}-tab`" role="tab"
        :aria-controls="`${tab.id}-panel`" :aria-selected="selected === tab.id"
        :tabindex="selected === tab.id ? 0 : -1"
        @click="selected = tab.id" @keydown="switchTab($event, index)">{{ tab.label }}</button>
    </div>
    <TabPane v-for="tab in tabs" :key="tab.id" :id="tab.id" :active="selected === tab.id">
      <slot :name="tab.id" />
    </TabPane>
  </div>
</template>
