"""Design constants for the Python renderer.

The pixel layout at 1920x1080 and the brand colours. editor/src/timing.js mirrors the geometry for the
live preview, so change both together.
"""
W, H = 1920, 1080

BRAND = {
    "canvas":      "#0C322C",   # Jungle     - background
    "panel":       "#FFFFFF",   # White      - left panel
    "bar_fill":    "#16453B",   # Pine       - headline bar
    "bar_line":    "#FFFFFF",   # White      - headline bar outline
    "pill_base":   "#30BA78",   # SUSE Green - inactive chapter
    "pill_active": "#FE7C3F",   # SUSE Orange - active chapter
    "pill_line":   "#0C322C",   # Jungle     - pill outline
    "pill_text":   "#0C322C",
    "headline":    "#FFFFFF",
    "accent":      "#FE7C3F",   # SUSE Orange - accent words in the headline
    "product":     "#0C322C",
    "content_bg":  "#EFEFEF",   # Fog        - placeholder when no video is given
}

PANEL   = dict(cx=220,  cy=540, w=412,  h=1051, r=45)
PILL    = dict(cx=220,  w=380, h=108, r=26, pitch=126, cy_last=977, line=3)
CHAPTER_VIEW = dict(cx=220, cy=662, w=380, h=738, r=0)
CHAPTER_SCROLL = dict(visible=6, previous=2, seconds=0.4, indicator_px=20,
                      indicator_y=1047, arrow_x=390, arrow_top=276)
BAR     = dict(cx=1184, cy=122, w=1468, h=217, r=30, line=3)
CONTENT = dict(cx=1181, cy=657, w=1459, h=820,  r=0)
LOGO_W_PX = 324
LOGO_CY, PRODUCT_CY, PRODUCT_PX = 114, 197, 56
TEXT_SCALE = 1.11            # shared with editor/src/timing.js so the preview and the render fit text identically
PRODUCT_MAX_W = 350
PILL_TEXT_PAD = 28
PILL_TEXT_PX = 28
HEADLINE_PX, HEADLINE_MAX_W = 70, 1320
LOGO_VISIBLE_PX = 880        # visible mark width inside the 1125 px wide logo PNG
