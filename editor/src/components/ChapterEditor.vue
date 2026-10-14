<script setup>
import { ref } from 'vue';
import ChapterRow from './ChapterRow.vue';

defineProps({
  chapters: { type: Array, required: true },
  switches: { type: Array, required: true },
  title: { type: String, required: true },
  product: { type: String, required: true },
  offset: { type: Number, required: true },
});
const emit = defineEmits(['begin-edit', 'update-time', 'commit-time', 'error', 'select',
  'choose-chapter', 'update-chapter-title', 'delete-switch', 'delete-chapter', 'add-chapter',
  'add-switch', 'update-metadata']);
const namesList = ref(null), namesDetails = ref(null);
function focusChapter(ch) {
  namesDetails.value.open = true;
  const input = namesList.value.querySelector(`input[data-chapter="${ch}"]`);
  input.focus();
  input.select();
}
defineExpose({ focusChapter });
</script>

<template>
  <section class="card">
    <h2>Chapter buttons <span class="heading-hint">when the orange pill switches</span></h2>
    <div id="chapters">
      <ChapterRow v-for="chapter in switches" :key="chapter.id" :chapter="chapter" :chapters="chapters" :offset="offset"
        @begin-edit="emit('begin-edit')" @update-time="emit('update-time', chapter, $event)"
        @commit-time="emit('commit-time')" @error="emit('error', $event)" @select="emit('select', chapter)"
        @choose-chapter="emit('choose-chapter', chapter, $event)"
        @update-title="emit('update-chapter-title', chapter.ch, $event)" @delete="emit('delete-switch', chapter)" />
    </div>
    <div class="tools">
      <button id="addChapter" @click="emit('add-chapter')">+ Add chapter</button>
      <button id="addChapterSwitch" @click="emit('add-switch')">+ Add chapter switch</button>
      <details ref="namesDetails" class="names-details">
        <summary>Names: video title, product, chapter buttons</summary>
        <div id="meta" class="names">
          <label class="inline">title <input id="titleIn" :value="title" placeholder="Video title (for your own reference)"
            @focus="emit('begin-edit')" @input="emit('update-metadata', 'title', $event.target.value)"></label>
          <label class="inline">product <input id="productIn" :value="product" placeholder="Shown under the logo"
            @focus="emit('begin-edit')" @input="emit('update-metadata', 'product_name', $event.target.value)"></label>
        </div>
        <div id="names" ref="namesList" class="names">
          <div v-for="(name, i) in chapters" :key="i" class="inline">
            <label class="inline">{{ i + 1 }} <input :value="name" :data-chapter="i + 1" :aria-label="`Chapter ${i + 1} title`"
              @focus="emit('begin-edit')" @input="emit('update-chapter-title', i + 1, $event.target.value)"></label>
            <button class="icon ghost" title="Delete chapter and all its switches" @click="emit('delete-chapter', i + 1)">✕</button>
          </div>
        </div>
      </details>
    </div>
    <p class="hint">Edit chapter titles below the dropdown or in Names. Add a switch to revisit an existing chapter; deleting its last switch
      also removes its button. More than six chapters scroll automatically with the active chapter.</p>
  </section>
</template>
