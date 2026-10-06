#!/usr/bin/env python3
"""The Fusion script and the Python renderer draw the same layout from two copies of the same constants.
This fails if they drift apart.   python tests/check_layout_sync.py"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "render"))
import layout  # noqa: E402

src = (ROOT / "fusion" / "build_chapter_template.py").read_text()
brand = src[src.index("BRAND = {"):src.index("}", src.index("BRAND = {")) + 1]
lay = src[src.index("W, H = 1920, 1080"):src.index("comp = fu.GetCurrentComp()")]
ns = {"ACTIVE_CHAPTER": 1}      # the layout block refers to a variable defined earlier in the script
exec(brand, ns)
exec(lay, ns)

bad = []
for key, val in layout.BRAND.items():
    if key in ns["BRAND"] and ns["BRAND"][key].upper() != val.upper():
        bad.append("BRAND[%r]: fusion %s, render %s" % (key, ns["BRAND"][key], val))
for name in ("W", "H", "PANEL", "PILL", "BAR", "CONTENT", "LOGO_W_PX", "LOGO_CY", "PRODUCT_CY", "PRODUCT_PX",
             "TEXT_SCALE", "PRODUCT_MAX_W", "PILL_TEXT_PAD", "PILL_TEXT_PX", "HEADLINE_PX", "HEADLINE_MAX_W"):
    if ns.get(name) != getattr(layout, name):
        bad.append("%s: fusion %r, render %r" % (name, ns.get(name), getattr(layout, name)))
if bad:
    sys.exit("Layout constants differ between fusion/build_chapter_template.py and render/layout.py:\n  " + "\n  ".join(bad))
print("layout constants match (%d brand colours, geometry, text sizes)" % len(layout.BRAND))
