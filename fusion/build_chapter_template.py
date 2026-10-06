"""
SUSE chapter-loop template builder for DaVinci Resolve (Fusion page) / Fusion Studio.
Part of demo-booth-video-template - see README.md for the full walkthrough.

Branding: SUSE Design System (colours, SUSE typeface, logo). Layout: white rounded chapter panel on
the left, outlined headline bar top right, flat 16:9 content slot below it.

QUICK USE
  1. Install the SUSE font (Regular, Medium, SemiBold) and restart Resolve.
  2. Turn your video into a compound clip, open it on the Fusion page.
  3. Workspace > Console, switch to Py3, paste this whole file, press Enter.
  4. Everything that changes per video (chapter names, when the orange pill switches, every headline and
     its start time) lives in timings/<TIMING_NAME>. Edit it in the timing editor (docs/index.html),
     save, and re-run this script - it clears its own old nodes first.
"""
import json
import os
import struct

# ----------------------------------------------------------------- BRAND (from SUSE Design System)
BRAND = {
    "canvas":      "#0C322C",   # Jungle     - background
    "panel":       "#FFFFFF",   # White      - left panel
    "bar_fill":    "#16453B",   # Pine       - headline bar
    "bar_line":    "#FFFFFF",   # White      - headline bar outline
    "pill_base":   "#30BA78",   # SUSE Green - inactive chapter
    "pill_active": "#FE7C3F",   # SUSE Orange - active chapter
    "pill_line":   "#0C322C",   # Jungle     - pill outline
    "pill_text":   "#0C322C",   # Jungle text (white on SUSE Green/Orange is low contrast)
    "headline":    "#FFFFFF",
    "accent":      "#FE7C3F",   # SUSE Orange - accent words in the headline
    "product":     "#0C322C",   # Jungle     - product name on white panel
    "content_bg":  "#EFEFEF",   # Fog        - placeholder when no media is connected
    "font":        "SUSE",
    "style_head":  "Medium",    # brand rule: headlines Medium, not Bold
    "style_ui":    "Medium",
}
# ---- WHERE THINGS ARE ------------------------------------------------------------------
TIMING_NAME = "example.json"     # <-- which file in timings/ to build from
REPO_DIR = ""                    # leave empty: the repo folder is found automatically (see below)
# -----------------------------------------------------------------------------------------

def _find_repo():
    """Locate this repo (the folder with assets/ and timings/) so no path ever needs editing.
    Tries: REPO_DIR above, $DEMO_BOOTH_REPO, the folder this file lives in (if run as a file, not pasted),
    then the usual clone locations."""
    home = os.path.expanduser("~")
    name = "demo-booth-video-template"
    cands = [REPO_DIR, os.environ.get("DEMO_BOOTH_REPO", "")]
    try:
        cands.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    except NameError:
        pass                                              # pasted into the Console: no __file__
    cands += [os.path.join(home, d, name) for d in ("Documents/GitHub", "GitHub", "Developer", "Documents",
                                                     "Desktop", "Downloads", "Projects", "src", "git")]
    cands = [os.path.expanduser(c) for c in cands if c]
    for c in cands:
        if os.path.isfile(os.path.join(c, "assets", "SUSE_Logo-hor_Green.png")) and os.path.isdir(os.path.join(c, "timings")):
            return c
    raise RuntimeError("Could not find the %s folder. Looked in:\n  %s\nSet REPO_DIR at the top of the script to "
                       "the folder that contains assets/ and timings/." % (name, "\n  ".join(cands)))

REPO_DIR = _find_repo()
print("Using repo: %s   timing file: %s" % (REPO_DIR, TIMING_NAME))
LOGO_PATH = os.path.join(REPO_DIR, "assets", "SUSE_Logo-hor_Green.png")
# Only used to measure headline word widths. First one that exists wins; without one the script falls
# back to a rough width estimate (headline spacing is then less exact).
FONT_FILE = next((f for f in (os.path.join(REPO_DIR, "assets", "fonts", "SUSE-Medium.otf"),
                              os.path.expanduser("~/Library/Fonts/SUSE-Medium.otf"),
                              "/Library/Fonts/SUSE-Medium.otf") if os.path.isfile(f)), "")

# ---- TIMING: chapters, pill switch times and headlines live in timings/<TIMING_NAME> ----
# Edit them in the timing editor (docs/index.html). Times are seconds from the start of the clip.
TIMING_FILE = os.path.join(REPO_DIR, "timings", TIMING_NAME)
try:
    with open(TIMING_FILE) as _f:
        _tm = json.load(_f)
except Exception as _e:
    raise RuntimeError("Could not read %s (%s). Check REPO_DIR and TIMING_NAME at the top of the script." % (TIMING_FILE, _e))

def _validate(tm):
    """Stop early with a readable message instead of a confusing Fusion error half-way through a build."""
    problems = []
    for key in ("chapters", "chapter_starts", "headlines"):
        if not tm.get(key):
            problems.append('"%s" is missing or empty' % key)
    if not problems:
        n = len(tm["chapters"])
        if not 1 <= n <= 6:
            problems.append("the layout fits 1 to 6 chapter buttons, found %d" % n)
        for sec, ch in tm["chapter_starts"]:
            if not 1 <= int(ch) <= n:
                problems.append("chapter switch at %ss points to chapter %s, but only 1-%d exist" % (sec, ch, n))
        for sec, text in tm["headlines"]:
            if float(sec) < 0 or not str(text).strip():
                problems.append("bad headline at %ss: %r" % (sec, text))
    if problems:
        raise ValueError("%s: %s" % (TIMING_FILE, "; ".join(problems)))

_validate(_tm)
PRODUCT_NAME = _tm.get("product_name", "SUSE AI Factory")   # shown under the logo
CHAPTERS = _tm["chapters"]                                                  # the six pill names
CHAPTER_STARTS = sorted((float(s), int(c)) for s, c in _tm["chapter_starts"])   # (seconds, pill 1-6)
HEADLINES = sorted((float(s), t) for s, t in _tm["headlines"])             # (seconds, text); *word* = accent
HEADLINES_END = _tm.get("headlines_end")      # seconds, or None = last headline stays to the end of the clip
WIPE_SECONDS = _tm.get("wipe_seconds", 0.8)   # left-to-right build-in time
ACTIVE_CHAPTER = CHAPTER_STARTS[0][1]
# -----------------------------------------------------------------------------------------

# ----------------------------------------------------------------- LAYOUT (px @ 1920x1080, from the reference frames)
W, H = 1920, 1080
PANEL   = dict(cx=220,  cy=540, w=412,  h=1051, r=45)   # 14 px of canvas shows on its left
# Pills fill the space under the title block: 18 px gaps between pills (grouped), ~60 px between the
# title group and the list, 34 px bottom margin (same as the panel's top/left margin)
PILL    = dict(cx=220,  w=380, h=108, r=26, pitch=126, cy_last=977, line=3)
BAR     = dict(cx=1184, cy=122, w=1468, h=217, r=30, line=3)
CONTENT = dict(cx=1181, cy=657, w=1459, h=820,  r=0)
LOGO_W_PX = 324   # visible width of the logo on the panel
LOGO_CY, PRODUCT_CY, PRODUCT_PX = 114, 197, 56
TEXT_SCALE = 1.11            # Text+ draws ~11% wider than Size x font advances (measured in Resolve);
                             # if headline words touch or gap too much, nudge this
PRODUCT_MAX_W = 350        # product name shrinks to fit inside the panel
ACTIVE_STATIC = ACTIVE_CHAPTER   # highlighted chapter if CTRL controls can't be created
PILL_TEXT_PAD = 28           # min. space between text and pill edge
PILL_TEXT_PX = 28           # long chapter names must fit inside the 380 px pill (~345 px drawn)
HEADLINE_PX, HEADLINE_MAX_W = 70, 1320   # headline shrinks to fit HEADLINE_MAX_W

comp = fu.GetCurrentComp()  # noqa: F821  (provided by Fusion)
comp.StartUndo("Build SUSE chapter template")

# Re-run safety: remove everything from a previous run (all nodes except MediaIn/MediaOut) so copies
# don't pile up on top of each other. Set to False if this comp has other nodes you want to keep.
CLEAN_RERUN = True
if CLEAN_RERUN:
    for _t in list(comp.GetToolList(False).values()):
        if _t.ID not in ("MediaIn", "MediaOut"):
            _t.Delete()


# ----------------------------------------------------------------- helpers
def rgb(hexstr):
    h = hexstr.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))

def nx(px): return px / W
def ny(py): return 1.0 - py / H

_x = [0]
def add(tool_id, name):
    _x[0] += 1
    t = comp.AddTool(tool_id, _x[0], 0)
    t.SetAttrs({"TOOLS_Name": name})
    return t

def solid(name, hexstr):
    bg = add("Background", name)
    r, g, b = rgb(hexstr)
    bg.SetInput("TopLeftRed", r); bg.SetInput("TopLeftGreen", g)
    bg.SetInput("TopLeftBlue", b); bg.SetInput("TopLeftAlpha", 1.0)
    return bg

def rrect(name, d, cy=None):
    m = add("RectangleMask", name)
    m.SetInput("Center", [nx(d["cx"]), ny(d["cy"] if cy is None else cy)])
    # Mask Width is relative to image width, Height to image height (verified in Resolve)
    m.SetInput("Width", d["w"] / W)
    m.SetInput("Height", d["h"] / H)
    m.SetInput("CornerRadius", min(0.5, d["r"] / min(d["w"], d["h"])))
    m.SetInput("Solid", 1)
    return m

def merge(prev, layer, name, mask=None):
    m = add("Merge", name)
    m.Background = prev
    m.Foreground = layer
    if mask is not None:
        m.EffectMask = mask
    return m

def boxed(prev, name, d, fill, line_hex=None, cy=None, blend=None):
    """Rounded box with an optional outline (outer shape in line colour, inner shape in fill).
    blend: optional expression (in comp time) that fades the whole box in and out via the Merge Blend."""
    cy = d["cy"] if cy is None else cy
    bw = d.get("line", 0)
    if line_hex and bw:
        prev = merge(prev, solid(name + "Line", line_hex), name + "LineMerge", rrect(name + "LineMask", d, cy))
        if blend:
            prev.Blend.SetExpression(blend)
        d = dict(d, w=d["w"] - 2 * bw, h=d["h"] - 2 * bw, r=max(0, d["r"] - bw))
    m = merge(prev, fill, name + "Merge", rrect(name + "Mask", d, cy))
    if blend:
        m.Blend.SetExpression(blend)
    return m

def text(name, string, cx, cy, size_px, hexstr, style=None, expr=None):
    t = add("TextPlus", name)
    t.SetInput("StyledText", string)
    t.SetInput("Font", BRAND["font"])
    t.SetInput("Style", style or BRAND["style_ui"])
    t.SetInput("Size", size_px / H)
    t.SetInput("Center", [nx(cx), ny(cy)])
    r, g, b = rgb(hexstr)
    t.SetInput("Red1", r); t.SetInput("Green1", g); t.SetInput("Blue1", b)
    if expr:
        getattr(t, "StyledText").SetExpression(expr)
    return t

_metrics = []
def _font_advances(path):
    """Read per-character advance widths (em fraction) straight from the .otf: cmap fmt 4 + hmtx."""
    try:
        d = open(path, "rb").read()
        tabs = {}
        for i in range(struct.unpack(">H", d[4:6])[0]):
            tag, _, off, _ = struct.unpack(">4sIII", d[12 + 16 * i:28 + 16 * i])
            tabs[tag.decode("latin-1")] = off
        upem = struct.unpack(">H", d[tabs["head"] + 18:tabs["head"] + 20])[0]
        nh = struct.unpack(">H", d[tabs["hhea"] + 34:tabs["hhea"] + 36])[0]
        adv = struct.unpack(">%dH" % (2 * nh),
                            b"".join(d[tabs["hmtx"] + 4 * i:tabs["hmtx"] + 4 * i + 4] for i in range(nh)))[0::2]
        cm, sub = tabs["cmap"], None
        for i in range(struct.unpack(">H", d[cm + 2:cm + 4])[0]):
            pid, eid, off = struct.unpack(">HHI", d[cm + 4 + 8 * i:cm + 12 + 8 * i])
            if struct.unpack(">H", d[cm + off:cm + off + 2])[0] == 4 and pid in (0, 3):
                sub = cm + off
                break
        sx2 = struct.unpack(">H", d[sub + 6:sub + 8])[0]
        seg = sx2 // 2
        ends = struct.unpack(">%dH" % seg, d[sub + 14:sub + 14 + sx2])
        starts = struct.unpack(">%dH" % seg, d[sub + 16 + sx2:sub + 16 + 2 * sx2])
        deltas = struct.unpack(">%dh" % seg, d[sub + 16 + 2 * sx2:sub + 16 + 3 * sx2])
        ros = struct.unpack(">%dH" % seg, d[sub + 16 + 3 * sx2:sub + 16 + 4 * sx2])

        def glyph(c):
            for i in range(seg):
                if ends[i] >= c:
                    if starts[i] > c:
                        return 0
                    if ros[i] == 0:
                        return (c + deltas[i]) & 0xFFFF
                    p = sub + 16 + 3 * sx2 + 2 * i + ros[i] + 2 * (c - starts[i])
                    g = struct.unpack(">H", d[p:p + 2])[0]
                    return (g + deltas[i]) & 0xFFFF if g else 0
            return 0

        def width(ch):
            g = glyph(ord(ch))
            return adv[g if g < nh else nh - 1] / float(upem)
        return width
    except Exception as e:
        print("Font metrics unavailable (%s) - using rough width estimate." % e)
        return None

def measure(s, size_px):
    """Pixel width of s in the SUSE font (exact from the .otf, else a rough estimate)."""
    if not _metrics:
        _metrics.append(_font_advances(FONT_FILE))
    if _metrics[0]:
        return sum(_metrics[0](c) for c in s) * size_px * TEXT_SCALE
    else:
        # fallback: per-character estimate (narrow / wide letters) for the SUSE font
        total = 0.0
        for c in s:
            if c in "iljtf.,:;'!|I": total += 0.30
            elif c == " ": total += 0.26
            elif c in "rJ": total += 0.40
            elif c in "mwMW": total += 0.86
            elif c.isupper(): total += 0.64
            else: total += 0.54
        return total * size_px


# comp time is in frames; the clip's first frame is COMPN_GlobalStart (not always 0 in Resolve)
FPS = float(comp.GetPrefs("Comp.FrameFormat.Rate") or 24)
T0 = comp.GetAttrs().get("COMPN_GlobalStart", 0)
def frames(sec): return int(round(T0 + sec * FPS))


# ----------------------------------------------------------------- control node
ctrl = add("Background", "CTRL")
ctrl.SetInput("TopLeftAlpha", 0.0)
n_ch = len(CHAPTERS)
controls = {
    "ActiveChapter": {"LINKID_DataType": "Number", "INPID_InputControl": "SliderControl",
                      "INP_Integer": True, "INP_MinScale": 1, "INP_MaxScale": n_ch,
                      "INP_MinAllowed": 1, "INP_MaxAllowed": n_ch, "INP_Default": 1,
                      "LINKS_Name": "Active Chapter"},
}
for i in range(1, n_ch + 1):
    controls["Chapter%d" % i] = {"LINKID_DataType": "Text", "INPID_InputControl": "TextEditControl",
                                 "TEC_Lines": 1, "LINKS_Name": "Chapter %d" % i}
ctrl.UserControls = controls
ctrl.SetInput("ActiveChapter", ACTIVE_CHAPTER)
for i, name in enumerate(CHAPTERS, 1):
    ctrl.SetInput("Chapter%d" % i, name)

# Only wire expressions to CTRL if its controls really exist; otherwise they fail silently
# (empty pill text, no highlighted pill) - fall back to static values instead.
try:
    CTRL_OK = ctrl.GetInput("ActiveChapter") is not None and ctrl.GetInput("Chapter1") == CHAPTERS[0]
except Exception:
    CTRL_OK = False
if not CTRL_OK:
    print("WARNING: CTRL user controls were not created - chapter NAMES are static (edit headline_timing.json).")

# Which pill is orange over time, as ONE expression in comp time (frames). The pills read this
# directly (not via the CTRL slider), so they switch even if the slider's own expression doesn't evaluate.
ACTIVE_EXPR = None
if len(CHAPTER_STARTS) > 1:
    ACTIVE_EXPR = str(CHAPTER_STARTS[-1][1])
    for i in range(len(CHAPTER_STARTS) - 2, -1, -1):
        ACTIVE_EXPR = "iif(time < %d, %d, %s)" % (frames(CHAPTER_STARTS[i + 1][0]), CHAPTER_STARTS[i][1], ACTIVE_EXPR)
    for sec, ch in CHAPTER_STARTS:
        print("Chapter %d (%s) from %.1fs (frame %d)" % (ch, CHAPTERS[ch - 1], sec, frames(sec)))
    if CTRL_OK:
        try:
            ctrl.ActiveChapter.SetExpression(ACTIVE_EXPR)   # keeps the slider in step, for display
        except Exception as _e:
            print("Note: could not drive the CTRL slider (%s); the pills do not depend on it." % _e)
elif CTRL_OK:
    ACTIVE_EXPR = "CTRL.ActiveChapter"


# ----------------------------------------------------------------- layers
out = solid("Canvas", BRAND["canvas"])

# left panel
out = merge(out, solid("PanelFill", BRAND["panel"]), "PanelMerge", rrect("PanelMask", PANEL))

# logo (PNG; Resolve's Fusion can't read SVG)
if os.path.isfile(LOGO_PATH):
    ld = add("Loader", "SUSE_Logo")
    ld.SetInput("Clip", LOGO_PATH)
    # Position with the Merge itself: a Transform's Center is relative to the 1125x368 PNG, not the frame
    out = merge(out, ld, "LogoMerge")
    out.SetInput("Center", [nx(PANEL["cx"]), ny(LOGO_CY)])
    out.SetInput("Size", LOGO_W_PX / 880.0)   # visible mark is ~880 px of the 1125 px PNG
else:
    print("LOGO_PATH not found (%s) - using a text placeholder. Check that assets/SUSE_Logo-hor_Green.png exists in the repo and re-run." % LOGO_PATH)
    out = merge(out, text("LogoPlaceholder", "SUSE", PANEL["cx"], LOGO_CY, 72,
                          BRAND["product"], style="SemiBold"), "LogoMerge")

PRODUCT_PX = min(PRODUCT_PX, PRODUCT_PX * PRODUCT_MAX_W / max(1.0, measure(PRODUCT_NAME, PRODUCT_PX)))
out = merge(out, text("ProductName", PRODUCT_NAME, PANEL["cx"], PRODUCT_CY, PRODUCT_PX, BRAND["product"],
                      style=BRAND["style_head"]), "ProductMerge")

# chapter pills (outlined): fill colour driven by CTRL.ActiveChapter
# one text size for all pills, fitted to the longest name with PILL_TEXT_PAD px of padding each side
PILL_TEXT_PX = min(PILL_TEXT_PX, PILL_TEXT_PX * (PILL["w"] - 2 * PILL_TEXT_PAD) /
                   max(1.0, max(measure(c, PILL_TEXT_PX) for c in CHAPTERS)))
base, act = rgb(BRAND["pill_base"]), rgb(BRAND["pill_active"])
# Each pill = green base + an orange copy on top whose Merge Blend is 1 only while its chapter is active.
# (Same Blend-by-time mechanism as the headlines; colour expressions on the pills did not show in the viewer.)
chapter_windows = {}
for k, (sec, ch) in enumerate(CHAPTER_STARTS):
    end = frames(CHAPTER_STARTS[k + 1][0]) if k + 1 < len(CHAPTER_STARTS) else None
    chapter_windows.setdefault(ch, []).append((frames(sec), end))

def window_expr(ws):
    parts = ["iif(time < %d, 0, 1)" % a if b is None else "iif(time < %d, 0, iif(time < %d, 1, 0))" % (a, b)
             for a, b in ws]
    return " + ".join("(%s)" % p for p in parts)

pill_on = {}
for i in range(1, n_ch + 1):
    cy = PILL["cy_last"] - (n_ch - i) * PILL["pitch"]
    out = boxed(out, "Pill%d" % i, PILL, solid("PillFill%d" % i, BRAND["pill_base"]), BRAND["pill_line"], cy=cy)
    if i in chapter_windows:
        out = boxed(out, "PillOn%d" % i, PILL, solid("PillOnFill%d" % i, BRAND["pill_active"]),
                    BRAND["pill_line"], cy=cy, blend=window_expr(chapter_windows[i]))
        pill_on[i] = out
    out = merge(out, text("PillText%d" % i, CHAPTERS[i - 1], PILL["cx"], cy, PILL_TEXT_PX,
                          BRAND["pill_text"], expr=("CTRL.Chapter%d" % i) if CTRL_OK else None),
                "PillTextMerge%d" % i)

# self-check: the orange overlay must be ON at the start of its chapter and OFF just before it
for sec, ch in CHAPTER_STARTS:
    try:
        on = pill_on[ch].GetInput("Blend", frames(sec) + 1)
        off = pill_on[ch].GetInput("Blend", max(0, frames(sec) - 2)) if sec > 0 else 0
        print("check %5.0fs: pill %d overlay blend on=%.0f before=%.0f -> %s" %
              (sec, ch, on, off, "ok" if on > 0.5 and off < 0.5 else "WRONG"))
    except Exception as _e:
        print("check skipped (%s)" % _e)

# content slot: MediaIn1 if present, else a Fog placeholder
src = comp.FindTool("MediaIn1")
if src is None:
    src = solid("ContentPlaceholder", BRAND["content_bg"])
xf = add("Transform", "ContentXf")
xf.Input = src
xf.SetInput("Center", [nx(CONTENT["cx"]), ny(CONTENT["cy"])])
xf.SetInput("Size", CONTENT["w"] / W)   # assumes a 1920x1080 source
out = merge(out, xf, "ContentMerge", rrect("ContentMask", CONTENT))

# headline bar (Pine, white outline) + headline with SUSE Orange accent words
out = boxed(out, "Bar", BAR, solid("BarFill", BRAND["bar_fill"]), BRAND["bar_line"])

def parse_headline(s):
    """'Plus the NVIDIA *AI stack*, now' -> [(word, is_accent), ...]; accents may span several words
    and may be followed by punctuation."""
    words, acc = [], False
    for tok in s.split():
        if tok.startswith("*"):
            acc = True
        words.append((tok.replace("*", ""), acc))
        if tok.rstrip(".,;:!?)\"'").endswith("*") and tok.strip("*"):
            acc = False
    return words

parsed = [(sec, parse_headline(s)) for sec, s in HEADLINES]
# one text size for every headline, fitted to the longest, so the size doesn't jump between headlines
size = min([HEADLINE_PX] + [HEADLINE_PX * HEADLINE_MAX_W /
                            max(1.0, measure(" ".join(w for w, _ in ws), HEADLINE_PX)) for _, ws in parsed])
space = measure("a a", size) - measure("aa", size)
wipe_frames = max(1, int(round(WIPE_SECONDS * FPS)))
PAD = 12   # px of slack so the wipe doesn't clip glyph overhang

for k, (sec, words) in enumerate(parsed, 1):
    start = frames(sec)
    end = frames(parsed[k][0]) if k < len(parsed) else (frames(HEADLINES_END) if HEADLINES_END else None)
    widths = [measure(w, size) for w, _ in words]
    total = sum(widths) + space * (len(words) - 1)
    x0 = BAR["cx"] - total / 2.0

    # left-to-right wipe: a mask whose left edge is fixed and whose width grows with time
    prog = "iif(time < %d, 0, iif(time > %d, 1, (time - %d) / %d))" % (start, start + wipe_frames, start, wipe_frames)
    full = total + 2 * PAD
    wm = add("RectangleMask", "HeadlineWipe%d" % k)
    wm.SetInput("Height", (BAR["h"] - 2 * BAR["line"]) / H)
    wm.SetInput("Solid", 1)
    wm.Width.SetExpression("(%s) * %.6f" % (prog, full / W))
    wm.Center.SetExpression("Point(%.6f + (%s) * %.6f, %.6f)" % (nx(x0 - PAD), prog, full / 2.0 / W, ny(BAR["cy"])))

    # visibility window: this headline shows from its start until the next headline starts
    if end is None:
        vis = "iif(time < %d, 0, 1)" % start
    else:
        vis = "iif(time < %d, 0, iif(time < %d, 1, 0))" % (start, end)
    for n, ((w, accent), wd) in enumerate(zip(words, widths), 1):
        out = merge(out, text("H%d_Word%d" % (k, n), w, x0 + wd / 2.0, BAR["cy"], size,
                              BRAND["accent"] if accent else BRAND["headline"], style=BRAND["style_head"]),
                    "H%d_Merge%d" % (k, n), mask=wm)
        out.Blend.SetExpression(vis)
        x0 += wd + space
    print("Headline %d at %.1fs (frame %d): %s" % (k, sec, start, " ".join(w for w, _ in words)))

# output
mo = comp.FindTool("MediaOut1") or add("MediaOut", "MediaOut1")
mo.Input = out

comp.EndUndo(True)
print("SUSE chapter template built. Select CTRL to edit chapters and the active chapter.")
