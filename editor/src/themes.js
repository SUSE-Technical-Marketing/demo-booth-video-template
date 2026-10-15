import catalog from '../../assets/themes.json';

export const THEMES = catalog.themes;
export const DEFAULT_THEME = catalog.default;
export const TEXT_SCALE = catalog.text_scale;

export function themeLayout(name = 'classic') {
  if (typeof name !== 'string' || !Object.hasOwn(THEMES, name)) {
    throw new Error(`Unknown video theme: ${String(name)}`);
  }
  return THEMES[name];
}

export function wrapText(text, maxWidth, measure) {
  const lines = [];
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const last = lines.at(-1);
    if (last && measure(`${last} ${word}`) <= maxWidth) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return lines;
}

export function fitWrappedPx(texts, base, maxWidth, maxLines, measure) {
  const fits = px => texts.every(text => {
    const lines = wrapText(text, maxWidth, value => measure(value, px));
    return lines.length <= maxLines && lines.every(line => measure(line, px) <= maxWidth);
  });
  if (fits(base)) return base;
  let low = 0, high = base;
  for (let i = 0; i < 16; i++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low;
}
