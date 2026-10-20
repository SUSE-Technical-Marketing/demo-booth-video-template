"""Pillow drawing for the chapter panel, the headline bar and the headline text.

Everything is drawn at 1920x1080 with the SUSE Medium font from assets/. Rounded shapes are drawn at 4x and
scaled down so the edges are smooth.
"""
from functools import lru_cache
from pathlib import Path
import re

from PIL import Image, ImageDraw, ImageFont

import layout as L
from chapter_scroll import labels, parents, scroll_position, scroll_steps, visible_rows
from timing import headline_intervals, normalize_chapters

ROOT = Path(__file__).resolve().parent.parent
FONT_PATH = ROOT / "assets" / "fonts" / "SUSE-Medium.otf"
LOGO_PATH = ROOT / "assets" / "SUSE_Logo-hor_Green.png"
SS = 4          # supersampling factor for rounded shapes
SUB_SCALE = 0.88  # sub-chapter text relative to a chapter title
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
    widest = max((text_width(t, base_px) for t in texts), default=0)
    return min(base_px, base_px * max_w / max(1.0, widest))


def wrap_text(text, max_w, px):
    lines = []
    for word in text.split():
        if lines and text_width(lines[-1] + " " + word, px) <= max_w:
            lines[-1] += " " + word
        else:
            lines.append(word)
    return lines


def fit_wrapped_px(texts, base_px, max_w, max_lines):
    def fits(px):
        for text in texts:
            lines = wrap_text(text, max_w, px)
            if len(lines) > max_lines or any(text_width(line, px) > max_w for line in lines):
                return False
        return True

    if fits(base_px):
        return base_px
    low, high = 0, base_px
    for _ in range(16):
        middle = (low + high) / 2
        if fits(middle):
            low = middle
        else:
            high = middle
    return low


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
    """Return (text run, is_accent) pairs, keeping spaces and exact marker boundaries."""
    runs, accent = [], False
    for part in re.split(r"(\*+)", " ".join(s.split())):
        if part.startswith("*"):
            accent = not accent
        elif part:
            runs.append((part, accent))
    return runs


class Layout:
    """Pre-computes sizes and draws the layers for one timing file."""

    def __init__(self, timing, theme="classic", duration=None):
        D = self.design = L.theme_layout(theme)
        self.theme = theme
        self.horizontal = getattr(D, "CHAPTER_AXIS", "vertical") == "horizontal"
        if timing.get("schema_version") == 2:
            timing = dict(timing)
            normalize_chapters(timing)
        self.t = timing
        self.chapters = timing["chapters"]
        self.n = len(self.chapters)
        # Only some themes list sub-chapters; the others show every chapter, so a flat list is just all level 0.
        self.nested = bool(getattr(D, "SUBCHAPTERS", False)) and any(timing.get("chapter_levels") or [])
        self.levels = list(timing["chapter_levels"]) if self.nested else [0] * self.n
        self.labels, self.parent = labels(self.levels), parents(self.levels)
        self.chapter_cx = (D.CHAPTER_VIEW["cx"] - (min(self.n, D.CHAPTER_SCROLL["visible"]) - 1) * D.PILL["pitch"] / 2
                           if self.horizontal else D.PILL["cx"])
        self.product = timing.get("product_name", "")
        self.wipe = float(timing.get("wipe_seconds", 0.8))
        self.chapter_starts = sorted((float(s), int(c)) for s, c in timing["chapter_starts"])
        self.duration = duration if duration is not None else timing.get("chapters_end") or max(
            60, *(s for s, _ in self.chapter_starts), *(s for s, _ in timing["headlines"]),
            timing.get("headlines_end") or 0) + 30
        self.scroll_steps = scroll_steps(self.chapter_starts, self.n, D.CHAPTER_SCROLL, self.levels)
        intervals = headline_intervals(timing)
        self.headlines = [(start, parse_headline(text)) for start, text, _ in intervals]
        self.hl_ends = [end for _, _, end in intervals]
        S = L.TEXT_SCALE
        self.pill_px = (fit_wrapped_px(self.chapters, D.PILL_TEXT_PX * S, D.PILL_TEXT_MAX_W, D.PILL_LINES)
                        if D.PILL_LINES > 1 else fit_px(self.chapters, D.PILL_TEXT_PX * S, D.PILL_TEXT_MAX_W))
        self.sub_inset = 20 if theme == "dark-rail" else 44     # how far a sub-chapter is pulled in
        self.sub_px = fit_wrapped_px([t for t, level in zip(self.chapters, self.levels) if level] or [" "],
                                     D.PILL_TEXT_PX * S * SUB_SCALE, D.PILL_TEXT_MAX_W - self.sub_inset, D.PILL_LINES)
        self.chapter_px = [self.sub_px if level else self.pill_px for level in self.levels]
        self.chapter_lines = [wrap_text(title, D.PILL_TEXT_MAX_W - (self.sub_inset if level else 0), px)
                              for title, level, px in zip(self.chapters, self.levels, self.chapter_px)]
        self.prod_px = fit_px([self.product or " "], D.PRODUCT_PX * S, D.PRODUCT_MAX_W)
        plains = ["".join(run for run, _ in parse_headline(text)) for _, text in timing["headlines"]]
        self.hl_px = fit_px(plains, D.HEADLINE_PX * S, D.HEADLINE_MAX_W)
        self.bar_x = int(round(D.BAR["cx"] - D.BAR["w"] / 2))
        self.bar_y = int(round(D.BAR["cy"] - D.BAR["h"] / 2))
        self.slot = (int(D.CONTENT["cx"] - D.CONTENT["w"] / 2), int(D.CONTENT["cy"] - D.CONTENT["h"] / 2))
        self.slot_size = (D.CONTENT["w"], D.CONTENT["h"])
        self._logo = None

    # ---- what is showing at time t -------------------------------------------------------------
    def chapter_at(self, t):
        ch = self.chapter_starts[0][1]
        for s, c in self.chapter_starts:
            if s <= t + 1e-6:
                ch = c
        return ch

    def chapter_number(self, active):
        """(number of the top-level chapter playing, number of top-level chapters)."""
        top = self.parent[active - 1]
        return sum(1 for level in self.levels[:top] if not level), sum(1 for level in self.levels if not level)

    def span(self, active):
        """(start, end) of the chapter the progress line follows: a chapter plus all of its sub-chapters."""
        starts = self.chapter_starts
        shown = self.parent[active - 1] if self.nested else active
        index = next(i for i, (_, ch) in enumerate(starts) if ch == shown)
        following = next((i for i in range(index + 1, self.n) if not self.levels[starts[i][1] - 1]), None)
        end = self.duration if following is None else starts[following][0]
        return starts[index][0], min(end, self.duration, self.t.get("chapters_end") or float("inf"))

    def headline_at(self, t):
        """(index, start_seconds) of the headline showing at t, or None."""
        found = None
        for i, (s, _) in enumerate(self.headlines):
            if s <= t + 1e-6 and (self.hl_ends[i] is None or t < self.hl_ends[i]):
                found = (i, s)
        return found

    # ---- layers --------------------------------------------------------------------------------
    @lru_cache(maxsize=1)
    def background(self):
        """Static branding, chapter panel and headline bar."""
        D = self.design
        B = D.BRAND
        cinematic = self.theme == "cinematic"
        img = Image.new("RGBA" if cinematic else "RGB", (L.W, L.H), (0, 0, 0, 0) if cinematic else rgb(B["canvas"]))
        if cinematic:
            draw = ImageDraw.Draw(img)
            for fade in D.FADES:
                for row in range(fade["h"]):
                    alpha = round(fade["from"] + (fade["to"] - fade["from"]) * row / (fade["h"] - 1))
                    draw.line((0, fade["y"] + row, L.W - 1, fade["y"] + row), fill=(*rgb(B["canvas"]), alpha))
        elif D.PANEL["w"]:
            paste_box(img, D.PANEL, B["panel"])
        if self._logo is None:
            self._logo = Image.open(LOGO_PATH).convert("RGBA")
            if self.theme != "classic":
                light = Image.new("RGBA", self._logo.size, (255, 255, 255, 0))
                light.putalpha(self._logo.getchannel("A"))
                self._logo = light
        s = D.LOGO_W_PX / float(L.LOGO_VISIBLE_PX)
        size = (round(self._logo.width * s), round(self._logo.height * s))
        logo = self._logo.resize(size, Image.LANCZOS)
        position = (int(D.LOGO_CX - size[0] / 2), int(D.LOGO_CY - size[1] / 2))
        if cinematic:
            img.alpha_composite(logo, position)
        else:
            img.paste(logo, position, logo)
        d = ImageDraw.Draw(img)
        if self.product:
            d.text((D.PRODUCT_CX + (D.PRODUCT_MAX_W / 2 if cinematic else 0), D.PRODUCT_CY),
                   self.product, font=font(self.prod_px), fill=rgb(B["product"]), anchor="rm" if cinematic else "mm")
        if not cinematic:
            paste_box(img, D.BAR, B["bar_fill"], B["bar_line"])
        return img

    @lru_cache(maxsize=8)
    def chapter_base(self, active, offset=0):
        """Draw the chapter viewport at a timeline-derived scroll offset."""
        D = self.design
        B = D.BRAND
        img = self.background().copy()
        if self.theme == "cinematic":
            d = ImageDraw.Draw(img)
            x = D.CHAPTER_VIEW["cx"] - D.CHAPTER_VIEW["w"] / 2
            cy = D.CHAPTER_VIEW["cy"]
            d.text((x, cy), "%02d / %02d" % (active, self.n),
                   font=font(D.CHAPTER_SCROLL["indicator_px"] * L.TEXT_SCALE), fill=rgb(B["accent"]), anchor="lm")
            d.text((x + D.PILL_TEXT_PAD, cy), self.chapters[active - 1],
                   font=font(self.pill_px), fill=rgb(B["pill_text"]), anchor="lm")
            return img
        rows = visible_rows(self.levels, active)          # chapters listed now (sub-chapters only for the open one)
        n = len(rows)
        scrolling = n > D.CHAPTER_SCROLL["visible"]
        # a list that grows and shrinks stays anchored at the top
        count = D.CHAPTER_SCROLL["visible"] if self.theme == "dark-rail" or self.nested else min(n, D.CHAPTER_SCROLL["visible"])
        view = D.CHAPTER_VIEW
        left, top = int(view["cx"] - view["w"] / 2), int(view["cy"] - view["h"] / 2)
        clipped = scrolling or self.horizontal
        pills = Image.new("RGB", (view["w"], view["h"]), rgb(B["panel"])) if clipped else img
        d = ImageDraw.Draw(pills)
        for pos, i in enumerate(rows, 1):
            sub = self.levels[i - 1]
            opened = self.nested and i != active and i == self.parent[active - 1]   # the chapter whose sub-chapter plays
            cx = self.chapter_cx + ((pos - 1 - offset) * D.PILL["pitch"] if self.horizontal else 0)
            cy = D.PILL["cy_last"] - (0 if self.horizontal else (count - pos + offset) * D.PILL["pitch"])
            if clipped:
                cx -= left
                cy -= top
                if (cx + D.PILL["w"] / 2 <= 0 or cx - D.PILL["w"] / 2 >= view["w"] or
                        cy + D.PILL["h"] / 2 <= 0 or cy - D.PILL["h"] / 2 >= view["h"]):
                    continue
            pill = dict(D.PILL, cx=cx) if clipped else dict(D.PILL)
            if sub and self.theme == "classic":               # sub-chapter buttons are smaller and sit to the right
                pill.update(cx=pill["cx"] + self.sub_inset / 2, w=pill["w"] - self.sub_inset, h=round(pill["h"] * 0.82))
            line = B["pill_active"] if opened and self.theme == "classic" else B["pill_line"]
            paste_box(pills, pill, B["pill_active"] if i == active else B["pill_base"], line, cy=cy)
            if self.theme == "dark-rail" or self.horizontal:
                x = pill["cx"] - pill["w"] / 2
                if i == active and not self.horizontal:
                    d.rectangle((x, cy - pill["h"] / 2 + 16, x + 3, cy + pill["h"] / 2 - 17), fill=rgb(B["accent"]))
                lit = i == active or opened
                d.text((x + 12 + (14 if sub else 0), cy), self.labels[i - 1],
                       font=font(D.CHAPTER_SCROLL["indicator_px"] * L.TEXT_SCALE * (0.9 if sub else 1)),
                       fill=rgb(B["accent"] if lit else B["pill_text"]), anchor="lm")
                lines = self.chapter_lines[i - 1]
                for row, text in enumerate(lines):
                    y = cy + (row - (len(lines) - 1) / 2) * self.chapter_px[i - 1] * 1.15
                    d.text((x + D.PILL_TEXT_PAD + (self.sub_inset if sub else 0), y), text, font=font(self.chapter_px[i - 1]),
                           fill=rgb(B["headline"] if lit else B["pill_text"]), anchor="lm")
            else:
                d.text((pill["cx"], cy), self.chapters[i - 1], font=font(self.chapter_px[i - 1]),
                       fill=rgb(B["pill_text"]), anchor="mm")
        if clipped:
            img.paste(pills, (left, top))
        if scrolling or self.theme == "dark-rail" or self.horizontal:
            d = ImageDraw.Draw(img)
            settings = D.CHAPTER_SCROLL
            indicator_font = font(settings["indicator_px"] * L.TEXT_SCALE)
            d.text((D.CHAPTER_VIEW["cx"], settings["indicator_y"]), "Chapter %d of %d" % self.chapter_number(active),
                   font=indicator_font, fill=rgb(B["product"]), anchor="mm")
            if offset > 1e-6:
                d.text((settings["arrow_x"], settings["arrow_top"]), "<" if self.horizontal else "^",
                       font=indicator_font, fill=rgb(B["product"]), anchor="mm")
            if offset < n - count - 1e-6:
                d.text((settings["arrow_end_x"] if self.horizontal else settings["arrow_x"],
                        settings["arrow_top"] if self.horizontal else settings["indicator_y"]), ">" if self.horizontal else "v",
                       font=indicator_font, fill=rgb(B["product"]), anchor="mm")
        return img

    @lru_cache(maxsize=64)
    def headline_layer(self, idx):
        """(RGBA image the size of the bar with the headline drawn centred, left edge x, text width)."""
        D = self.design
        B = D.BRAND
        runs = self.headlines[idx][1]
        f = font(self.hl_px)
        widths = [f.getlength(run) for run, _ in runs]
        total = sum(widths)
        img = Image.new("RGBA", (D.BAR["w"], D.BAR["h"]), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        x = D.BAR["w"] / 2 - total / 2                       # centred in the bar, in every theme
        left = x
        for (run, accent), width in zip(runs, widths):
            d.text((x, D.BAR["h"] / 2), run, font=f, anchor="lm",
                   fill=rgb(B["accent"] if accent else B["headline"]))
            x += width
        return img, left, total

    @lru_cache(maxsize=4)
    def with_headline(self, active, idx, offset=0):
        """chapter_base with headline idx fully drawn."""
        img = self.chapter_base(active, offset).copy()
        layer, _, _ = self.headline_layer(idx)
        if img.mode == "RGBA":
            img.alpha_composite(layer, (self.bar_x, self.bar_y))
        else:
            img.paste(layer, (self.bar_x, self.bar_y), layer)
        return img

    # ---- one frame -----------------------------------------------------------------------------
    def frame(self, t, video=None):
        """Full 1920x1080 RGB frame at timing-time t. video: a PIL image already sized to the slot, or None."""
        active = self.chapter_at(t)
        D = self.design
        offset = scroll_position(t, self.scroll_steps, D.CHAPTER_SCROLL["seconds"])
        hl = self.headline_at(t)
        if hl is None:
            img = self.chapter_base(active, offset).copy()
        else:
            idx, start = hl
            p = 1.0 if self.wipe <= 0 else max(0.0, min(1.0, (t - start) / self.wipe))
            if p >= 1.0:
                img = self.with_headline(active, idx, offset).copy()
            else:                                    # left-to-right wipe: reveal a growing slice of the text
                img = self.chapter_base(active, offset).copy()
                layer, left, total = self.headline_layer(idx)
                reveal = int(round(left - PAD + p * (total + 2 * PAD)))
                if reveal > 0:
                    part = layer.crop((0, 0, min(layer.width, reveal), layer.height))
                    if img.mode == "RGBA":
                        img.alpha_composite(part, (self.bar_x, self.bar_y))
                    else:
                        img.paste(part, (self.bar_x, self.bar_y), part)
        if video is None:
            video = Image.new("RGB", self.slot_size, rgb(D.BRAND["content_bg"]))
        if self.theme == "cinematic":
            img = Image.alpha_composite(video.convert("RGBA"), img).convert("RGB")
        else:
            mask = rrect_mask(*self.slot_size, D.CONTENT["r"]) if D.CONTENT["r"] else None
            img.paste(video, self.slot, mask)
        if self.theme != "classic":
            start, end = self.span(active)
            progress = max(0.0, min(1.0, (t - start) / max(0.001, end - start)))
            box = D.PROGRESS
            track = Image.new("RGB", (box["w"], box["h"]), rgb(D.BRAND["pill_active"]))
            width = round(box["w"] * progress)
            if width:
                ImageDraw.Draw(track).rectangle((0, 0, width - 1, box["h"] - 1), fill=rgb(D.BRAND["accent"]))
            x = int(box["cx"] - box["w"] / 2 + (self.chapter_cx - D.PILL["cx"] +
                    (active - 1 - offset) * D.PILL["pitch"] if self.horizontal else 0))
            y = int(box["cy"] - box["h"] / 2)
            mask = rrect_mask(box["w"], box["h"], box["r"])
            left, right = 0, box["w"]
            if self.horizontal:
                mask = rrect_mask(D.PILL["w"], D.PILL["h"], D.PILL["r"]).crop(
                    (0, D.PILL["h"] - box["h"], box["w"], D.PILL["h"]))
                view_left = int(D.CHAPTER_VIEW["cx"] - D.CHAPTER_VIEW["w"] / 2)
                left, right = max(0, view_left - x), min(box["w"], view_left + D.CHAPTER_VIEW["w"] - x)
            if right > left:
                if self.horizontal:
                    img.paste(rgb(D.BRAND["panel"]), (x + left, y, x + right, y + box["h"]))
                img.paste(track.crop((left, 0, right, box["h"])), (x + left, y),
                          mask.crop((left, 0, right, box["h"])))
        return img
