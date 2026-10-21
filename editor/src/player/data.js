import { DEFAULT, fromJSON } from '../timing.js';
import { DEFAULT_THEME, themeLayout } from '../themes.js';

/**
 * What the exported page was made from: { title, output: { theme }, timing, video }. Without it (the dev server, a page
 * opened before the export filled it in) the sample project is shown, without a video.
 */
export function boothState(text) {
  let data = {};
  try { data = JSON.parse(text || '{}') || {}; } catch { data = {}; }
  const theme = data.output?.theme ?? DEFAULT_THEME;
  themeLayout(theme);
  const state = { ...fromJSON(data.timing ?? DEFAULT), output: { theme } };
  return { state, video: typeof data.video === 'string' ? data.video : '', title: data.title || state.title || 'Demo' };
}
