<script setup>
import { ref } from 'vue';
import ChapterRow from './ChapterRow.vue';

const props = defineProps({
  chapters: { type: Array, required: true },
  starts: { type: Array, required: true },
  title: { type: String, required: true },
  product: { type: String, required: true },
  offset: { type: Number, required: true },
  end: { type: Number, required: true },
});
const emit = defineEmits(['begin-edit', 'update-time', 'commit-time', 'error', 'select',
  'update-chapter-title', 'delete-chapter', 'add-chapter', 'update-metadata']);
const chaptersList = ref(null);
function rowDuration(i) {
  return Math.min(props.starts[i + 1]?.t ?? props.end, props.end) - props.starts[i].t;
}
function focusChapter(ch) {
  const input = chaptersList.value.querySelector(`input[data-chapter="${ch}"]`);
  input.scrollIntoView({ block: 'center', behavior: 'smooth' });
  input.focus();
  input.select();
}
defineExpose({ focusChapter });
</script>

<template>
  <section class="card">
    <h2>Chapters <span class="heading-hint">one button per chapter, in timeline order</span></h2>
    <div id="chapters" ref="chaptersList">
      <ChapterRow v-for="(chapter, i) in starts" :key="chapter.id" :chapter="chapter" :title="chapters[i]" :offset="offset"
        :duration="rowDuration(i)"
        @begin-edit="emit('begin-edit')" @update-time="emit('update-time', chapter, $event)"
        @commit-time="emit('commit-time')" @error="emit('error', $event)" @select="emit('select', chapter)"
        @update-title="emit('update-chapter-title', chapter.ch, $event)" @delete="emit('delete-chapter', chapter.ch)" />
    </div>
    <div class="tools">
      <button id="addChapter" @click="emit('add-chapter')">+ Add chapter</button>
      <details class="metadata-details">
        <summary>Video title and product</summary>
        <div id="meta" class="names">
          <label class="inline">title <input id="titleIn" :value="title" placeholder="Video title (for your own reference)"
            @focus="emit('begin-edit')" @input="emit('update-metadata', 'title', $event.target.value)"></label>
          <label class="inline">product <input id="productIn" :value="product" placeholder="Shown under the logo"
            @focus="emit('begin-edit')" @input="emit('update-metadata', 'product_name', $event.target.value)"></label>
        </div>
      </details>
    </div>
    <p class="hint">Edit each chapter's start and title directly in its row. Length is the time until the next chapter
      or preview end. Chapters advance in order without reuse; more than six scroll automatically.</p>
  </section>
</template>
