"""Pillow drawing for the chapter panel, the headline bar and the headline text.

Everything is drawn at 1920x1080 with the SUSE Medium font from assets/. Rounded shapes are drawn at 4x and
scaled down so the edges are smooth.
"""
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import layout as L

ROOT = Path(__file__).resolve().parent.parent
FONT_PATH = ROOT / "assets" / "fonts" / "SUSE-Medium.otf"
LOGO_PATH = ROOT / "assets" / "SUSE_Logo-hor_Green.png"
SS = 4          # supersampling factor for rounded shapes
PAD = 12        # px of slack either side of the headline wipe so glyph overhang isn't clipped


def rgb(hexstr):
    h = hexstr.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


@lru_cache(maxsize=64)
def font(px):
    return ImageFont.truetype(str(FONT_PATH), float(px))


def text_width(text, px):
    return font(px).getlength(text)


def fit_px(texts, base_px, max_w):
    """Largest size <= base_px at which the widest of texts is no wider than max_w."""
    widest = max(text_width(t, base_px) for t in texts)
    return min(base_px, base_px * max_w / max(1.0, widest))


@lru_cache(maxsize=32)
def rrect_mask(w, h, r):
    w, h = int(round(w)), int(round(h))
    big = Image.new("L", (w * SS, h * SS), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, w * SS - 1, h * SS - 1), radius=r * SS, fill=255)
    return big.resize((w, h), Image.LANCZOS)


def paste_box(img, d, fill_hex, line_hex=None, cy=None):
    """Rounded box; with line_hex and d['line'] it gets an outline (outer shape in the line colour)."""
    cy = d["cy"] if cy is None else cy
    w, h, r = d["w"], d["h"], d["r"]
    x, y = int(round(d["cx"] - w / 2)), int(round(cy - h / 2))
    bw = d.get("line", 0)
    if line_hex and bw:
        img.paste(rgb(line_hex), (x, y), rrect_mask(w, h, r))
        img.paste(rgb(fill_hex), (x + bw, y + bw), rrect_mask(w - 2 * bw, h - 2 * bw, max(0, r - bw)))
    else:
        img.paste(rgb(fill_hex), (x, y), rrect_mask(w, h, r))
    return x, y


def parse_headline(s):
    """'Plus the NVIDIA *AI stack*, now' -> [(word, is_accent)]. Same rules as the Fusion script and the editor."""
    words, acc = [], False
    for tok in s.split():
        if tok.startswith("*"):
            acc = True
        words.append((tok.replace("*", ""), acc))
        if tok.rstrip(".,;:!?)\"'").endswith("*") and tok.strip("*"):
            acc = False
    return words


class Layout:
    """Pre-computes sizes and draws the layers for one timing file."""

    def __init__(self, timing):
        self.t = timing
        self.chapters = timing["chapters"]
        self.n = len(self.chapters)
        self.product = timing.get("product_name", "")
        self.wipe = float(timing.get("wipe_seconds", 0.8))
        self.chapter_starts = sorted((float(s), int(c)) for s, c in timing["chapter_starts"])
        self.headlines = sorted((float(s), parse_headline(t)) for s, t in timing["headlines"])
        self.hl_end = timing.get("headlines_end")
        S = L.TEXT_SCALE
        self.pill_px = fit_px(self.chapters, L.PILL_TEXT_PX * S, L.PILL["w"] - 2 * L.PILL_TEXT_PAD)
        self.prod_px = fit_px([self.product or " "], L.PRODUCT_PX * S, L.PRODUCT_MAX_W)
        plains = [" ".join(w for w, _ in ws) for _, ws in self.headlines]
        self.hl_px = fit_px(plains, L.HEADLINE_PX * S, L.HEADLINE_MAX_W)
        self.bar_x = int(round(L.BAR["cx"] - L.BAR["w"] / 2))
        self.bar_y = int(round(L.BAR["cy"] - L.BAR["h"] / 2))
        self.slot = (int(L.CONTENT["cx"] - L.CONTENT["w"] / 2), int(L.CONTENT["cy"] - L.CONTENT["h"] / 2))
        self.slot_size = (L.CONTENT["w"], L.CONTENT["h"])
        self._logo = None

    # ---- what is showing at time t -------------------------------------------------------------
    def chapter_at(self, t):
        ch = self.chapter_starts[0][1]
        for s, c in self.chapter_starts:
            if s <= t + 1e-6:
                ch = c
        return ch

    def headline_at(self, t):
        """(index, start_seconds) of the headline showing at t, or None."""
        found = None
        for i, (s, _) in enumerate(self.headlines):
            if s <= t + 1e-6:
                found = (i, s)
        if found and self.hl_end is not None and t >= float(self.hl_end):
            return None
        return found

    # ---- layers --------------------------------------------------------------------------------
    @lru_cache(maxsize=8)
    def chapter_base(self, active):
        """Canvas + chapter panel (with `active` highlighted) + headline bar. The video slot is left empty."""
        B = L.BRAND
        img = Image.new("RGB", (L.W, L.H), rgb(B["canvas"]))
        paste_box(img, L.PANEL, B["panel"])
        if self._logo is None:
            self._logo = Image.open(LOGO_PATH).convert("RGBA")
        s = L.LOGO_W_PX / float(L.LOGO_VISIBLE_PX)
        size = (round(self._logo.width * s), round(self._logo.height * s))
        logo = self._logo.resize(size, Image.LANCZOS)
        img.paste(logo, (int(L.PANEL["cx"] - size[0] / 2), int(L.LOGO_CY - size[1] / 2)), logo)
        d = ImageDraw.Draw(img)
        if self.product:
            d.text((L.PANEL["cx"], L.PRODUCT_CY), self.product, font=font(self.prod_px),
                   fill=rgb(B["product"]), anchor="mm")
        for i in range(1, self.n + 1):
            cy = L.PILL["cy_last"] - (self.n - i) * L.PILL["pitch"]
            paste_box(img, L.PILL, B["pill_active"] if i == active else B["pill_base"], B["pill_line"], cy=cy)
            d.text((L.PILL["cx"], cy), self.chapters[i - 1], font=font(self.pill_px),
                   fill=rgb(B["pill_text"]), anchor="mm")
        paste_box(img, L.BAR, B["bar_fill"], B["bar_line"])
        return img

    @lru_cache(maxsize=64)
    def headline_layer(self, idx):
        """(RGBA image the size of the bar with the headline drawn centred, left edge x, text width)."""
        B = L.BRAND
        words = self.headlines[idx][1]
        f = font(self.hl_px)
        widths = [f.getlength(w) for w, _ in words]
        space = f.getlength(" ")
        total = sum(widths) + space * (len(words) - 1)
        img = Image.new("RGBA", (L.BAR["w"], L.BAR["h"]), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        x = L.BAR["w"] / 2 - total / 2
        left = x
        for (w, accent), wd in zip(words, widths):
            d.text((x, L.BAR["h"] / 2), w, font=f, anchor="lm",
                   fill=rgb(B["accent"] if accent else B["headline"]))
            x += wd + space
        return img, left, total

    @lru_cache(maxsize=4)
    def with_headline(self, active, idx):
        """chapter_base with headline idx fully drawn."""
        img = self.chapter_base(active).copy()
        layer, _, _ = self.headline_layer(idx)
        img.paste(layer, (self.bar_x, self.bar_y), layer)
        return img

    # ---- one frame -----------------------------------------------------------------------------
    def frame(self, t, video=None):
        """Full 1920x1080 RGB frame at timing-time t. video: a PIL image already sized to the slot, or None."""
        active = self.chapter_at(t)
        hl = self.headline_at(t)
        if hl is None:
            img = self.chapter_base(active).copy()
        else:
            idx, start = hl
            p = 1.0 if self.wipe <= 0 else max(0.0, min(1.0, (t - start) / self.wipe))
            if p >= 1.0:
                img = self.with_headline(active, idx).copy()
            else:                                    # left-to-right wipe: reveal a growing slice of the text
                img = self.chapter_base(active).copy()
                layer, left, total = self.headline_layer(idx)
                reveal = int(round(left - PAD + p * (total + 2 * PAD)))
                if reveal > 0:
                    part = layer.crop((0, 0, min(layer.width, reveal), layer.height))
                    img.paste(part, (self.bar_x, self.bar_y), part)
        if video is None:
            video = Image.new("RGB", self.slot_size, rgb(L.BRAND["content_bg"]))
        img.paste(video, self.slot)
        return img
