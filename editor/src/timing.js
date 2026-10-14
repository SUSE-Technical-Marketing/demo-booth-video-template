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

export function fromJSON(o) {
  if (!o || !Array.isArray(o.chapters) || !o.chapters.length || o.chapters.some(c => typeof c !== 'string')) {
    throw new Error('chapters must contain at least one chapter title');
  }
  if (!Array.isArray(o.chapter_starts) || !o.chapter_starts.length ||
      o.chapter_starts.some(r => !Array.isArray(r) || !validTime(r[0]) ||
        !Number.isInteger(r[1]) || r[1] < 1 || r[1] > o.chapters.length)) {
    throw new Error('chapter_starts must contain valid times and chapter numbers');
  }
  if (!Array.isArray(o.headlines) || !o.headlines.length ||
      o.headlines.some(r => !Array.isArray(r) || !validTime(r[0]) || typeof r[1] !== 'string' || !r[1].trim())) {
    throw new Error('headlines must contain valid times and non-empty text');
  }
  if (o.headlines_end != null && !validTime(o.headlines_end)) throw new Error('headlines_end must be a non-negative time');
  if (o.wipe_seconds != null && !validTime(o.wipe_seconds)) throw new Error('wipe_seconds must be non-negative');
  if (o.title != null && typeof o.title !== 'string') throw new Error('title must be text');
  if (o.product_name != null && typeof o.product_name !== 'string') throw new Error('product_name must be text');
  const state = {
    title: o.title || '',
    product_name: o.product_name ?? '',
    chapters: o.chapters.slice(),
    chapter_starts: o.chapter_starts.map(([t, ch]) => newRow({ t, ch })),
    headlines: o.headlines.map(([t, text]) => newRow({ t, text })),
    headlines_end: o.headlines_end ?? null,
    wipe_seconds: o.wipe_seconds ?? 0.8,
  };
  sortAll(state);
  return state;
}

export function toJSON(state) {
  if (state.chapters.length !== state.chapter_starts.length ||
      state.chapter_starts.some((chapter, i) => chapter.ch !== i + 1 ||
        (i > 0 && chapter.t < state.chapter_starts[i - 1].t))) {
    throw new Error('Each chapter must have exactly one start, in timeline order');
  }
  const n = v => JSON.stringify(+v.toFixed(2));
  return [
    '{',
    '  "schema_version": 1,',
    '  "title": ' + JSON.stringify(state.title || '') + ',',
    '  "product_name": ' + JSON.stringify(state.product_name || '') + ',',
    '  "chapters": ' + JSON.stringify(state.chapters) + ',',
    '  "chapter_starts": [\n' + state.chapter_starts.map(r => `    [${n(r.t)}, ${r.ch}]`).join(',\n') + '\n  ],',
    '  "headlines": [\n' + state.headlines.map(r => `    [${n(r.t)}, ${JSON.stringify(r.text)}]`).join(',\n') + '\n  ],',
    '  "headlines_end": ' + (state.headlines_end == null ? 'null' : n(state.headlines_end)) + ',',
    '  "wipe_seconds": ' + n(state.wipe_seconds),
    '}',
    '',
  ].join('\n');
}

export function sortAll(state) {
  state.chapter_starts.sort((a, b) => a.t - b.t);
  state.headlines.sort((a, b) => a.t - b.t);
  state.chapters = state.chapter_starts.map(c => state.chapters[c.ch - 1]);
  state.chapter_starts.forEach((c, i) => { c.ch = i + 1; });
}

export function chapterImportNotice(source) {
  const used = new Set(source.chapter_starts.map(([, ch]) => ch)), notices = [];
  if (used.size < source.chapter_starts.length) {
    notices.push('Converted repeated chapter switches into independent chapters.');
  }
  if (used.size < source.chapters.length) {
    notices.push('Ignored unused chapter titles with no start time.');
  }
  return notices.length ? notices.join(' ') + ' Save or Download to keep the converted file.' : '';
}

export function removeChapter(state, ch) {
  state.chapters.splice(ch - 1, 1);
  state.chapter_starts = state.chapter_starts.filter(c => c.ch !== ch);
  state.chapter_starts.forEach(c => { if (c.ch > ch) c.ch--; });
  sortAll(state);
}

export const duration = state => Math.max(60, ...state.headlines.map(h => h.t),
  ...state.chapter_starts.map(c => c.t), state.headlines_end || 0) + 30;

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
  const total = Math.floor(Math.max(0, t) + offset + 1e-6);
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
  state.headlines.forEach(h => { if (h.t <= t + 1e-6) headline = h; });
  return state.headlines_end != null && t >= state.headlines_end ? null : headline;
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
