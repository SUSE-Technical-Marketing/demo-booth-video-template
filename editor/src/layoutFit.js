import { fitPx, plain, TEXT_SCALE } from './timing.js';
import { fitWrappedPx, themeLayout } from './themes.js';

/**
 * The text sizes the preview uses: the headline shrinks to fit its longest line, chapter titles to their buttons and
 * the product name to its space. `measure(text, px)` returns a width; the editor and the exported page both pass a
 * canvas measurer, so they size text the same way.
 */
export function layoutFit(state, measure) {
  const design = themeLayout(state.output.theme);
  let best = { w: 1, idx: -1 };
  state.headlines.forEach((h, idx) => {
    const w = measure(plain(h.text), design.HEADLINE_PX);
    if (w > best.w) best = { w, idx };
  });
  return {
    headline: { px: fitPx(best.w, design.HEADLINE_PX, design.HEADLINE_MAX_W), idx: best.idx },
    pillPx: design.PILL_LINES > 1
      ? fitWrappedPx(state.chapters, design.PILL_TEXT_PX * TEXT_SCALE, design.PILL_TEXT_MAX_W, design.PILL_LINES, measure)
      : fitPx(Math.max(...state.chapters.map(c => measure(c, design.PILL_TEXT_PX))), design.PILL_TEXT_PX, design.PILL_TEXT_MAX_W),
    productPx: fitPx(measure(state.product_name || ' ', design.PRODUCT_PX), design.PRODUCT_PX, design.PRODUCT_MAX_W),
  };
}
