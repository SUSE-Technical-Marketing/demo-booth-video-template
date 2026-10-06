"""Design constants for the Python renderer.

These mirror the constants in fusion/build_chapter_template.py (same pixel layout at 1920x1080, same
brand colours). tests/check_layout_sync.py fails if the two drift apart, so change both together.
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
BAR     = dict(cx=1184, cy=122, w=1468, h=217, r=30, line=3)
CONTENT = dict(cx=1181, cy=657, w=1459, h=820,  r=0)
LOGO_W_PX = 324
LOGO_CY, PRODUCT_CY, PRODUCT_PX = 114, 197, 56
TEXT_SCALE = 1.11            # Fusion's Text+ draws 11% wider than "Size"; used here so both paths look the same
PRODUCT_MAX_W = 350
PILL_TEXT_PAD = 28
PILL_TEXT_PX = 28
HEADLINE_PX, HEADLINE_MAX_W = 70, 1320
LOGO_VISIBLE_PX = 880        # visible mark width inside the 1125 px wide logo PNG
