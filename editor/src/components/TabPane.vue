<script setup>
defineProps({
  id: { type: String, required: true },
  active: { type: Boolean, required: true },
});
</script>

<template>
  <div :id="`${id}-panel`" class="tab-pane" role="tabpanel" :aria-labelledby="`${id}-tab`"
    tabindex="0" v-show="active">
    <slot />
  </div>
</template>
