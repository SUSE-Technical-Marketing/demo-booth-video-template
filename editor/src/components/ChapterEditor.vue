<script setup>
import { computed, ref } from 'vue';
import ChapterRow from './ChapterRow.vue';
import DurationBadge from './DurationBadge.vue';
import HeadlineEditor from './HeadlineEditor.vue';
import { fmt, tc } from '../timing.js';

const props = defineProps({
  chapters: { type: Array, required: true },
  starts: { type: Array, required: true },
  offset: { type: Number, required: true },
  end: { type: Number, required: true },
  headlines: { type: Array, default: () => [] },
  headlineEnd: { type: Number, default: null },
  chaptersEnd: { type: Number, default: null },
  selectedId: { type: Number, default: null },
  textSizeId: { type: Number, default: null },
  selectedChapterId: { type: Number, default: null },
  playingChapterId: { type: Number, default: null },
  followPlayhead: { type: Boolean, default: false },
});
const emit = defineEmits(['begin-edit', 'update-time', 'commit-time', 'error', 'select',
  'update-chapter-title', 'delete-chapter', 'add-chapter', 'select-headline', 'update-follow',
  'update-text', 'add-headline', 'set-playhead', 'set-chapter-playhead', 'delete-headline', 'change-chapters-end']);
const chaptersList = ref(null);
const headlineEditor = ref(null);
const ownedHeadlines = chapter => props.headlines.filter(h => h.chapterId === chapter.id);
const selectedChapter = computed(() => props.starts.find(c => c.id === props.selectedChapterId) ?? props.starts[0]);
const selectedHeadlines = computed(() => ownedHeadlines(selectedChapter.value));
function rowDuration(i) {
  return Math.min(props.starts[i + 1]?.t ?? props.end, props.end, props.chaptersEnd ?? Infinity) - props.starts[i].t;
}
function headlineBoundary(chapter) {
  return Math.min(chapter.t + rowDuration(props.starts.indexOf(chapter)), props.headlineEnd ?? Infinity) - chapter.t;
}
function warningCount(chapter) {
  return ownedHeadlines(chapter).filter(h => h.t < 0 || h.t >= headlineBoundary(chapter)).length;
}
function focusChapter(ch) {
  const input = chaptersList.value.querySelector(`input[data-chapter="${ch}"]`);
  input.scrollIntoView({ block: 'center', behavior: 'smooth' });
  input.focus();
  input.select();
}
const focusHeadline = (id, focus = false) => headlineEditor.value.focusHeadline(id, focus);
defineExpose({ focusChapter, focusHeadline });
</script>

<template>
  <div class="chapter-editor">
    <section class="card chapter-navigation" aria-label="Chapters">
    <div class="section-heading">
      <h2>Chapters</h2>
      <button id="addChapter" @click="emit('add-chapter')">+ Chapter</button>
    </div>
    <div id="chapters" class="chapter-list" ref="chaptersList" aria-label="Chapter list">
      <ChapterRow v-for="(chapter, i) in starts" :key="chapter.id" :chapter="chapter" :title="chapters[i]" :offset="offset"
        :selected="selectedChapter.id === chapter.id" :playing="playingChapterId === chapter.id"
        :headline-count="ownedHeadlines(chapter).length" :warning-count="warningCount(chapter)"
        :duration="rowDuration(i)"
        @begin-edit="emit('begin-edit')" @update-time="emit('update-time', chapter, $event)"
        @commit-time="emit('commit-time')" @error="emit('error', $event)" @select="emit('select', chapter)"
        @update-title="emit('update-chapter-title', chapter.ch, $event)" @set-playhead="emit('set-chapter-playhead', chapter)"
        @delete="emit('delete-chapter', chapter.ch)" />
    </div>
    <label class="inline follow-control"><input id="followPlayhead" type="checkbox" :checked="followPlayhead"
      @change="emit('update-follow', $event.target.checked)"> Follow playhead
      <span class="playing-key">dot = playing chapter</span></label>
    </section>
    <section class="card chapter-inspector" aria-label="Selected chapter headlines" :data-chapter-id="selectedChapter.id">
      <div class="inspector-heading">
        <h3>{{ chapters[selectedChapter.ch - 1] }}</h3>
        <div class="inspector-timing"><span>Starts {{ fmt(selectedChapter.t) }}</span>
          <DurationBadge :duration="rowDuration(starts.indexOf(selectedChapter))" class="chapter-duration"
            title="Duration until the next chapter, configured end or preview end." />
          <label v-if="selectedChapter.id === starts.at(-1).id" class="inline chapter-end-control">
            Ends at <input id="chapterEndAt" class="time" aria-label="Last chapter end" size="7"
              :value="chaptersEnd == null ? '' : fmt(chaptersEnd)" :placeholder="`Auto: ${fmt(end)}`"
              :title="chaptersEnd == null ? 'Leave blank to use the video end or estimated preview end. Accepts elapsed time or full timecode.' : `${tc(chaptersEnd, offset)} as timecode. Clear to use the automatic end.`"
              @focus="emit('begin-edit')" @change="emit('change-chapters-end', $event)">
          </label>
        </div>
        <div class="headline-columns"><span>Within chapter</span><span>Headlines · {{ selectedHeadlines.length }}</span></div>
      </div>
        <HeadlineEditor ref="headlineEditor" :key="selectedChapter.id"
          :headlines="selectedHeadlines" :offset="offset + selectedChapter.t"
          :end="headlineBoundary(selectedChapter)"
          :selected-id="selectedId" :text-size-index="selectedHeadlines.findIndex(h => h.id === textSizeId)"
          @begin-edit="emit('begin-edit')" @update-time="(h, time) => emit('update-time', h, time)"
          @commit-time="emit('commit-time')" @error="emit('error', $event)"
          @select="emit('select-headline', $event)" @update-text="(h, text) => emit('update-text', h, text)"
          @add-headline="emit('add-headline', selectedChapter, $event)"
          @set-playhead="emit('set-playhead', $event)" @delete-headline="emit('delete-headline', $event)" />
    </section>
  </div>
</template>
