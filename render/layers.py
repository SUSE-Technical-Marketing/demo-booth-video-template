"""Pillow drawing for the chapter panel, the headline bar and the headline text.

Everything is drawn at 1920x1080 with the SUSE Medium font from assets/. Rounded shapes are drawn at 4x and
scaled down so the edges are smooth.
"""
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import layout as L
from chapter_scroll import scroll_position, scroll_steps
from timing import headline_intervals, normalize_chapters

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
    """'Plus the NVIDIA *AI stack*, now' -> [(word, is_accent)]. Same rules as the editor."""
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
        self.chapter_cx = (D.CHAPTER_VIEW["cx"] - (min(self.n, D.CHAPTER_SCROLL["visible"]) - 1) * D.PILL["pitch"] / 2
                           if self.horizontal else D.PILL["cx"])
        self.product = timing.get("product_name", "")
        self.wipe = float(timing.get("wipe_seconds", 0.8))
        self.chapter_starts = sorted((float(s), int(c)) for s, c in timing["chapter_starts"])
        self.duration = duration if duration is not None else timing.get("chapters_end") or max(
            60, *(s for s, _ in self.chapter_starts), *(s for s, _ in timing["headlines"]),
            timing.get("headlines_end") or 0) + 30
        self.scroll_steps = scroll_steps(self.chapter_starts, self.n, D.CHAPTER_SCROLL)
        intervals = headline_intervals(timing)
        self.headlines = [(start, parse_headline(text)) for start, text, _ in intervals]
        self.hl_ends = [end for _, _, end in intervals]
        S = L.TEXT_SCALE
        self.pill_px = (fit_wrapped_px(self.chapters, D.PILL_TEXT_PX * S, D.PILL_TEXT_MAX_W, D.PILL_LINES)
                        if D.PILL_LINES > 1 else fit_px(self.chapters, D.PILL_TEXT_PX * S, D.PILL_TEXT_MAX_W))
        self.chapter_lines = [wrap_text(title, D.PILL_TEXT_MAX_W, self.pill_px) for title in self.chapters]
        self.prod_px = fit_px([self.product or " "], D.PRODUCT_PX * S, D.PRODUCT_MAX_W)
        plains = [" ".join(w for w, _ in parse_headline(text)) for _, text in timing["headlines"]]
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
        scrolling = self.n > D.CHAPTER_SCROLL["visible"]
        count = D.CHAPTER_SCROLL["visible"] if self.theme == "dark-rail" else min(self.n, D.CHAPTER_SCROLL["visible"])
        view = D.CHAPTER_VIEW
        left, top = int(view["cx"] - view["w"] / 2), int(view["cy"] - view["h"] / 2)
        clipped = scrolling or self.horizontal
        pills = Image.new("RGB", (view["w"], view["h"]), rgb(B["panel"])) if clipped else img
        d = ImageDraw.Draw(pills)
        for i in range(1, self.n + 1):
            cx = self.chapter_cx + ((i - 1 - offset) * D.PILL["pitch"] if self.horizontal else 0)
            cy = D.PILL["cy_last"] - (0 if self.horizontal else (count - i + offset) * D.PILL["pitch"])
            if clipped:
                cx -= left
                cy -= top
                if (cx + D.PILL["w"] / 2 <= 0 or cx - D.PILL["w"] / 2 >= view["w"] or
                        cy + D.PILL["h"] / 2 <= 0 or cy - D.PILL["h"] / 2 >= view["h"]):
                    continue
            pill = dict(D.PILL, cx=cx) if clipped else D.PILL
            paste_box(pills, pill, B["pill_active"] if i == active else B["pill_base"], B["pill_line"], cy=cy)
            if self.theme == "dark-rail" or self.horizontal:
                x = pill["cx"] - pill["w"] / 2
                if i == active and not self.horizontal:
                    d.rectangle((x, cy - pill["h"] / 2 + 16, x + 3, cy + pill["h"] / 2 - 17), fill=rgb(B["accent"]))
                d.text((x + 12, cy), "%02d" % i, font=font(D.CHAPTER_SCROLL["indicator_px"] * L.TEXT_SCALE),
                       fill=rgb(B["accent"] if i == active else B["pill_text"]), anchor="lm")
                lines = self.chapter_lines[i - 1]
                for row, text in enumerate(lines):
                    y = cy + (row - (len(lines) - 1) / 2) * self.pill_px * 1.15
                    d.text((x + D.PILL_TEXT_PAD, y), text, font=font(self.pill_px),
                           fill=rgb(B["headline"] if i == active else B["pill_text"]), anchor="lm")
            else:
                d.text((pill["cx"], cy), self.chapters[i - 1], font=font(self.pill_px),
                       fill=rgb(B["pill_text"]), anchor="mm")
        if clipped:
            img.paste(pills, (left, top))
        if scrolling or self.theme == "dark-rail" or self.horizontal:
            d = ImageDraw.Draw(img)
            settings = D.CHAPTER_SCROLL
            indicator_font = font(settings["indicator_px"] * L.TEXT_SCALE)
            d.text((D.CHAPTER_VIEW["cx"], settings["indicator_y"]), "Chapter %d of %d" % (active, self.n),
                   font=indicator_font, fill=rgb(B["product"]), anchor="mm")
            if offset > 1e-6:
                d.text((settings["arrow_x"], settings["arrow_top"]), "<" if self.horizontal else "^",
                       font=indicator_font, fill=rgb(B["product"]), anchor="mm")
            if offset < self.n - count - 1e-6:
                d.text((settings["arrow_end_x"] if self.horizontal else settings["arrow_x"],
                        settings["arrow_top"] if self.horizontal else settings["indicator_y"]), ">" if self.horizontal else "v",
                       font=indicator_font, fill=rgb(B["product"]), anchor="mm")
        return img

    @lru_cache(maxsize=64)
    def headline_layer(self, idx):
        """(RGBA image the size of the bar with the headline drawn centred, left edge x, text width)."""
        D = self.design
        B = D.BRAND
        words = self.headlines[idx][1]
        f = font(self.hl_px)
        widths = [f.getlength(w) for w, _ in words]
        space = f.getlength(" ")
        total = sum(widths) + space * (len(words) - 1)
        img = Image.new("RGBA", (D.BAR["w"], D.BAR["h"]), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        x = D.BAR["w"] / 2 - total / 2                       # centred in the bar, in every theme
        left = x
        for (w, accent), wd in zip(words, widths):
            d.text((x, D.BAR["h"] / 2), w, font=f, anchor="lm",
                   fill=rgb(B["accent"] if accent else B["headline"]))
            x += wd + space
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
            index = next(i for i, (_, ch) in enumerate(self.chapter_starts) if ch == active)
            start = self.chapter_starts[index][0]
            end = min(self.chapter_starts[index + 1][0] if index + 1 < self.n else self.duration,
                      self.duration, self.t.get("chapters_end") or float("inf"))
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
