export const TEXT_SCALE = 1.11;
export const CHAPTER_VIEW = { cx: 220, cy: 662, w: 380, h: 738, r: 0 };
export const CHAPTER_SCROLL = { visible: 6, previous: 2, seconds: 0.4, indicator_px: 20,
  indicator_y: 1047, arrow_x: 390, arrow_top: 276 };
export const CH_COLORS = ['var(--ch1)', 'var(--ch2)', 'var(--ch3)', 'var(--ch4)', 'var(--ch5)', 'var(--ch6)'];

export const DEFAULT = {
  title: 'SUSE portfolio overview (sample)',
  product_name: 'SUSE portfolio',
  chapters: ['SUSE Rancher Prime', 'SUSE Observability', 'SUSE Virtualization', 'SUSE Security', 'SUSE Linux', 'SUSE MLM'],
  chapter_starts: [[0, 1], [30, 2], [60, 3], [90, 4], [120, 5], [150, 6]],
  headlines: [
    [0, 'Manage any *Kubernetes*, anywhere'],
    [15, 'Open source with enterprise *control*'],
    [30, 'See your whole stack in *one* view'],
    [45, 'Isolate the root *cause* faster'],
    [60, 'Run *VMs* and containers together'],
    [75, 'Modernize without *rip and replace*'],
    [90, 'Zero trust for your *containers*'],
    [105, 'Scan and protect at *runtime*'],
    [120, 'Linux for *mission-critical* workloads'],
    [135, 'Apply fixes without a *reboot*'],
    [150, 'Manage mixed Linux from *one* console'],
    [165, 'Automate patching and *compliance*'],
  ],
  headlines_end: null,
  wipe_seconds: 0.8,
};

let nextId = 0;
export const newRow = (values) => ({ id: ++nextId, ...values });
const validTime = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validChapterEnd = value => validTime(value) && value >= 0.01;
const validHeadline = (row, relative = false) => Array.isArray(row) && row.length === 2 &&
  typeof row[0] === 'number' && Number.isFinite(row[0]) && (relative || row[0] >= 0) &&
  typeof row[1] === 'string' && Boolean(row[1].trim());

export function fromJSON(o) {
  if (o?.schema_version != null && ![1, 2].includes(o.schema_version)) throw new Error('Unsupported timing schema version');
  const nested = o?.schema_version === 2;
  if (!o || !Array.isArray(o.chapters) || !o.chapters.length ||
      o.chapters.some(c => nested ? !c || typeof c.title !== 'string' || !validTime(c.start) ||
        !Array.isArray(c.headlines) || c.headlines.some(h => !validHeadline(h, true)) : typeof c !== 'string')) {
    throw new Error(nested ?
      'Each chapter needs a title, non-negative start and headline list with finite relative times and non-empty text' :
      'chapters must contain at least one chapter title');
  }
  if (!nested && (!Array.isArray(o.chapter_starts) || !o.chapter_starts.length ||
      o.chapter_starts.some(r => !Array.isArray(r) || r.length !== 2 || !validTime(r[0]) ||
        !Number.isInteger(r[1]) || r[1] < 1 || r[1] > o.chapters.length))) {
    throw new Error('chapter_starts must contain valid times and chapter numbers');
  }
  if (!nested && (!Array.isArray(o.headlines) || o.headlines.some(r => !validHeadline(r)))) {
    throw new Error('headlines must contain valid times and non-empty text');
  }
  if (o.headlines_end != null && !validTime(o.headlines_end)) throw new Error('headlines_end must be a non-negative time');
  if (o.chapters_end != null && !validChapterEnd(o.chapters_end)) {
    throw new Error('chapters_end must be at least 0.01 seconds or null');
  }
  if (o.wipe_seconds != null && !validTime(o.wipe_seconds)) throw new Error('wipe_seconds must be non-negative');
  if (o.title != null && typeof o.title !== 'string') throw new Error('title must be text');
  if (o.product_name != null && typeof o.product_name !== 'string') throw new Error('product_name must be text');
  const state = {
    title: o.title || '',
    product_name: o.product_name ?? '',
    chapters: nested ? o.chapters.map(c => c.title) : o.chapters.slice(),
    chapter_starts: nested ? o.chapters.map((c, i) => newRow({ t: c.start, ch: i + 1 })) :
      o.chapter_starts.map(([t, ch]) => newRow({ t, ch })),
    headlines: [],
    headlines_end: o.headlines_end ?? null,
    chapters_end: o.chapters_end ?? null,
    wipe_seconds: o.wipe_seconds ?? 0.8,
  };
  if (nested) {
    state.headlines = o.chapters.flatMap((c, i) => c.headlines.map(([t, text]) =>
      newRow({ t, text, chapterId: state.chapter_starts[i].id })));
  }
  sortAll(state);
  if (!nested) {
    state.headlines = o.headlines.map(([time, text]) => {
      const chapter = state.chapter_starts.findLast(c => c.t <= time) ?? state.chapter_starts[0];
      return newRow({ t: time - chapter.t, text, chapterId: chapter.id });
    });
    sortAll(state);
  }
  return state;
}

export function toJSON(state) {
  if (state.chapters_end != null && !validChapterEnd(state.chapters_end)) {
    throw new Error('chapters_end must be at least 0.01 seconds or null');
  }
  if (state.chapters.length !== state.chapter_starts.length ||
      state.chapter_starts.some((chapter, i) => chapter.ch !== i + 1 ||
        (i > 0 && chapter.t < state.chapter_starts[i - 1].t))) {
    throw new Error('Each chapter must have exactly one start, in timeline order');
  }
  state.headlines.forEach(h => headlineChapter(state, h));
  const n = value => +value.toFixed(2);
  return JSON.stringify({
    schema_version: 2,
    title: state.title || '',
    product_name: state.product_name || '',
    chapters: state.chapter_starts.map((c, i) => ({
      title: state.chapters[i], start: n(c.t),
      headlines: state.headlines.filter(h => h.chapterId === c.id).map(h => [n(h.t), h.text]),
    })),
    headlines_end: state.headlines_end == null ? null : n(state.headlines_end),
    chapters_end: state.chapters_end == null ? null : n(state.chapters_end),
    wipe_seconds: n(state.wipe_seconds),
  }, null, 2) + '\n';
}

export function sortAll(state) {
  state.chapter_starts.sort((a, b) => a.t - b.t);
  state.chapters = state.chapter_starts.map(c => state.chapters[c.ch - 1]);
  state.chapter_starts.forEach((c, i) => { c.ch = i + 1; });
  state.headlines.sort((a, b) => headlineTime(state, a) - headlineTime(state, b));
}

export function chapterImportNotice(source) {
  if (source.schema_version === 2) return '';
  const used = new Set(source.chapter_starts.map(([, ch]) => ch)), notices = [];
  if (used.size < source.chapter_starts.length) {
    notices.push('Converted repeated chapter switches into independent chapters.');
  }
  if (used.size < source.chapters.length) {
    notices.push('Ignored unused chapter titles with no start time.');
  }
  notices.push('Assigned headlines to their chapters using chapter-relative times.');
  return notices.join(' ') + ' Save or Download to keep the converted file.';
}

export function removeChapter(state, ch) {
  const removed = state.chapter_starts.find(c => c.ch === ch);
  state.headlines = state.headlines.filter(h => h.chapterId !== removed.id);
  state.chapters.splice(ch - 1, 1);
  state.chapter_starts = state.chapter_starts.filter(c => c.ch !== ch);
  state.chapter_starts.forEach(c => { if (c.ch > ch) c.ch--; });
  sortAll(state);
}

export const duration = state => state.chapters_end ?? Math.max(60, ...state.headlines.map(h => headlineTime(state, h)),
  ...state.chapter_starts.map(c => c.t), state.headlines_end || 0) + 30;

export function headlineChapter(state, headline) {
  const chapter = state.chapter_starts.find(c => c.id === headline.chapterId);
  if (!chapter) throw new Error('Headline has no owning chapter');
  return chapter;
}
export const headlineTime = (state, headline) => headlineChapter(state, headline).t + headline.t;
export function chapterEnd(state, chapter, end = duration(state)) {
  const i = state.chapter_starts.indexOf(chapter);
  return Math.min(state.chapter_starts[i + 1]?.t ?? end, end, state.chapters_end ?? Infinity);
}
export function headlineEnd(state, headline, end = duration(state)) {
  const chapter = headlineChapter(state, headline);
  const owned = state.headlines.filter(h => h.chapterId === chapter.id).sort((a, b) => a.t - b.t);
  const next = owned[owned.indexOf(headline) + 1];
  return Math.min(next ? headlineTime(state, next) : Infinity,
    chapterEnd(state, chapter, end), state.headlines_end ?? Infinity);
}
export function headlineOutside(state, headline, end = duration(state)) {
  return headline.t < 0 || headlineTime(state, headline) >=
    Math.min(chapterEnd(state, headlineChapter(state, headline), end), state.headlines_end ?? Infinity);
}

const pad = n => String(n).padStart(2, '0');
export function parseClock(s) {
  const parts = String(s).trim().split(':');
  if (!parts.length || parts.length > 3 || parts.some(p => p.trim() === '' || !Number.isFinite(+p) || +p < 0)) return NaN;
  return parts.reduce((total, p) => total * 60 + +p, 0);
}
export function parseTime(str, offset = 3600) {
  str = String(str).trim().replace(',', '.');
  const time = parseClock(str);
  return str.split(':').length === 3 && time >= offset ? time - offset : time;
}
export function fmt(t) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = +(t - m * 60).toFixed(1);
  return `${m}:${Number.isInteger(s) ? pad(s) : s.toFixed(1).padStart(4, '0')}`;
}
export function tc(t, offset = 3600) {
  const total = Math.floor(Math.max(0, t + offset) + 1e-6);
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}

export function headlineWords(text) {
  let accent = false;
  return text.split(/\s+/).filter(Boolean).map(token => {
    if (token.startsWith('*')) accent = true;
    const word = { text: token.replace(/\*/g, ''), accent };
    if (/\*[.,;:!?)"']*$/.test(token) && word.text) accent = false;
    return word;
  });
}
export const plain = text => headlineWords(text).map(w => w.text).join(' ');
export const fitPx = (width, base, maxWidth) =>
  TEXT_SCALE * Math.min(base, base * maxWidth / Math.max(1, width * TEXT_SCALE));

export function activeChapter(state, t) {
  let active = state.chapter_starts[0].ch;
  state.chapter_starts.forEach(c => { if (c.t <= t + 1e-6) active = c.ch; });
  return active;
}
export function activeHeadline(state, t) {
  let headline = null;
  const chapter = state.chapter_starts.find(c => c.ch === activeChapter(state, t));
  state.headlines.forEach(h => {
    const start = headlineTime(state, h);
    if (h.chapterId === chapter.id && h.t >= 0 && start <= t + 1e-6 &&
        t < headlineEnd(state, h, state.preview_end ?? duration(state))) headline = { ...h, t: start };
  });
  return headline;
}
export function scrollPosition(t, step) {
  const p = Math.max(0, Math.min(1, (t - step.t) / CHAPTER_SCROLL.seconds));
  return step.origin + (step.target - step.origin) * p * p * (3 - 2 * p);
}
export function chapterScrollSteps(state) {
  const windowStart = ch => Math.max(0, Math.min(state.chapters.length - CHAPTER_SCROLL.visible,
    ch - CHAPTER_SCROLL.previous - 1));
  const starts = state.chapter_starts.slice().sort((a, b) => a.t - b.t);
  const first = starts[0], target = windowStart(first.ch);
  const steps = [{ t: first.t, origin: target, target }];
  starts.slice(1).forEach(c => {
    const last = steps[steps.length - 1], target = windowStart(c.ch);
    if (target !== last.target) steps.push({ t: c.t, origin: scrollPosition(c.t, last), target });
  });
  return steps;
}
export function chapterScrollAt(t, steps) {
  let step = steps[0];
  steps.forEach(s => { if (s.t <= t) step = s; });
  return scrollPosition(t, step);
}
