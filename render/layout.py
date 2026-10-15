"""Video designs shared with the browser preview through assets/themes.json."""
import json
from pathlib import Path
from types import SimpleNamespace

W, H = 1920, 1080
CATALOG = json.loads((Path(__file__).resolve().parent.parent / "assets/themes.json").read_text())
THEMES = CATALOG["themes"]
TEXT_SCALE = CATALOG["text_scale"]
LOGO_VISIBLE_PX = 880        # visible mark width inside the 1125 px wide logo PNG


def theme_layout(name="classic"):
    if not isinstance(name, str) or name not in THEMES:
        raise ValueError("Unknown video theme: %s" % name)
    return SimpleNamespace(**THEMES[name])


_classic = theme_layout()
BRAND, PANEL, PILL = _classic.BRAND, _classic.PANEL, _classic.PILL
CHAPTER_VIEW, CHAPTER_SCROLL = _classic.CHAPTER_VIEW, _classic.CHAPTER_SCROLL
BAR, CONTENT = _classic.BAR, _classic.CONTENT
LOGO_W_PX, LOGO_CY = _classic.LOGO_W_PX, _classic.LOGO_CY
PRODUCT_CY, PRODUCT_PX, PRODUCT_MAX_W = _classic.PRODUCT_CY, _classic.PRODUCT_PX, _classic.PRODUCT_MAX_W
PILL_TEXT_PAD, PILL_TEXT_PX = _classic.PILL_TEXT_PAD, _classic.PILL_TEXT_PX
HEADLINE_PX, HEADLINE_MAX_W = _classic.HEADLINE_PX, _classic.HEADLINE_MAX_W
