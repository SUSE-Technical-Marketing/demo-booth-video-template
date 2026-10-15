"""Shared theme contracts, composition geometry and actual multi-clip exports."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "render"))
import layout as L
from layers import Layout, rgb, text_width
from project import validate_project
from render import find_ffmpeg, probe


def timing(count=12):
    return {"schema_version": 2, "product_name": "SUSE portfolio", "wipe_seconds": 0,
            "chapters": [{"title": "Chapter %d" % (i + 1), "start": i * 2,
                          "headlines": [[0, "A *modern* demo"]]} for i in range(count)]}


class ThemeTests(unittest.TestCase):
    def test_the_headline_is_centred_in_the_bar_in_every_theme(self):
        for theme in L.THEMES:
            with self.subTest(theme=theme):
                layout = Layout(timing(1), theme)
                design = layout.design
                image, left, total = layout.headline_layer(0)
                self.assertAlmostEqual(left + total / 2, design.BAR["w"] / 2, delta=1, msg="layer position")
                # and in the finished frame: the pixels the headline adds sit centred on the bar
                with_text = layout.with_headline(1, 0).convert("RGB")
                without = layout.chapter_base(1).convert("RGB")
                box = (layout.bar_x, layout.bar_y, layout.bar_x + design.BAR["w"], layout.bar_y + design.BAR["h"])
                ink = ImageChops.difference(with_text.crop(box), without.crop(box)).convert("L").point(
                    lambda value: 255 if value > 40 else 0).getbbox()
                self.assertIsNotNone(ink, "the headline drew nothing")
                width, middle = design.BAR["w"], (ink[0] + ink[2] - 1) / 2
                self.assertAlmostEqual(middle, width / 2, delta=6, msg="%s: ink spans %d-%d of %d" % (theme, ink[0], ink[2], width))

    def test_project_theme_contract_and_missing_theme_default(self):
        project = json.loads((ROOT / "tests/fixtures/project.json").read_text())
        for theme in L.THEMES:
            with self.subTest(theme=theme):
                candidate = copy.deepcopy(project)
                candidate["output"]["theme"] = theme
                self.assertIs(validate_project(candidate), candidate)
        validate_project(project)
        self.assertEqual(L.theme_layout().label, "Classic")
        for invalid in (None, "", "unknown", "__proto__", "constructor", 42, {}, True):
            candidate = copy.deepcopy(project)
            candidate["output"]["theme"] = invalid
            with self.subTest(theme=invalid), self.assertRaisesRegex(ValueError, "Unknown video theme"):
                validate_project(candidate)

    def test_dark_rail_agenda_scroll_and_short_list_top_alignment(self):
        for count in (2, 12):
            lay = Layout(timing(count), "dark-rail", count * 2)
            image = lay.frame(0)
            self.assertEqual(image.getpixel((49, 339)), rgb(lay.design.BRAND["accent"]))
            self.assertEqual(image.getpixel((55, 339)), rgb(lay.design.BRAND["pill_active"]))
        image = lay.frame(12.4)
        self.assertEqual(lay.chapter_at(12.4), 7)
        self.assertEqual(image.getpixel((49, 543)), rgb(lay.design.BRAND["accent"]))
        self.assertEqual(image.getpixel((48, 275)), rgb(lay.design.BRAND["panel"]))
        self.assertEqual(lay.frame(0).tobytes(), Layout(timing(), "dark-rail", 24).frame(0).tobytes())
        self.assertEqual(lay.slot_size, (1504, 846))
        self.assertEqual(lay.frame(0).getpixel(lay.slot), rgb(lay.design.BRAND["canvas"]))

    def test_rail_titles_fit_in_two_lines_including_long_unbroken_words(self):
        source = timing(3)
        for chapter, title in zip(source["chapters"], (
                "SUSE Rancher Prime", "A long chapter title with several words", "UnbreakablyLongChapterTitle")):
            chapter["title"] = title
        for theme in ("dark-rail", "minimal-stage"):
            with self.subTest(theme=theme):
                lay = Layout(source, theme, 6)
                for lines in lay.chapter_lines:
                    self.assertLessEqual(len(lines), 2)
                    self.assertTrue(all(text_width(line, lay.pill_px) <= lay.design.PILL_TEXT_MAX_W for line in lines))
                    self.assertLessEqual(len(lines) * lay.pill_px * 1.15, lay.design.PILL["h"])
                self.assertGreater(lay.pill_px, 0)
                lay.frame(1)

    def test_cinematic_keeps_full_frame_footage_below_protected_text(self):
        lay = Layout(timing(), "cinematic", 24)
        video = Image.new("RGB", lay.slot_size, (80, 120, 160))
        image = lay.frame(1, video)
        self.assertEqual(lay.slot, (0, 0))
        self.assertEqual(lay.slot_size, (1920, 1080))
        self.assertEqual(image.mode, "RGB")
        self.assertEqual(image.getpixel((960, 540)), (80, 120, 160))
        self.assertNotEqual(image.getpixel((960, 1060)), (80, 120, 160))
        self.assertNotEqual(lay.chapter_base(1).tobytes(), lay.chapter_base(2).tobytes())
        base = lay.chapter_base(1)
        self.assertNotEqual(lay.frame(1, video).crop((72, 799, 1848, 929)).tobytes(),
                            Image.alpha_composite(video.convert("RGBA"), base).convert("RGB").crop((72, 799, 1848, 929)).tobytes())

    def test_minimal_stage_centers_visible_pills_for_short_and_scrolling_agendas(self):
        design = L.theme_layout("minimal-stage")
        left = int(design.CHAPTER_VIEW["cx"] - design.CHAPTER_VIEW["w"] / 2)
        for count in (1, 2, 3, 4, 5, 6, 7, 12):
            with self.subTest(count=count):
                image = Layout(timing(count), "minimal-stage", count * 2).frame(0)
                pixels = [x for x in range(left, left + design.CHAPTER_VIEW["w"])
                          if image.getpixel((x, design.PILL["cy_last"])) != rgb(design.BRAND["canvas"])]
                self.assertEqual((pixels[0] + pixels[-1] + 1) / 2, L.W / 2)

    def test_minimal_stage_progress_is_clipped_to_the_pill(self):
        lay = Layout(timing(2), "minimal-stage", 6)
        strip = (666, 1060, 954, 1064)
        self.assertEqual(lay.frame(0).crop(strip).tobytes(), lay.chapter_base(1).crop(strip).tobytes())
        image = lay.frame(1.8)
        self.assertEqual(image.getpixel((810, 1062)), rgb(lay.design.BRAND["accent"]))
        self.assertEqual(image.getpixel((810, 1066)), rgb(lay.design.BRAND["canvas"]))
        self.assertEqual(image.getpixel((666, 1063)), rgb(lay.design.BRAND["canvas"]))

    def test_minimal_stage_keeps_footage_clear_and_scrolls_the_footer(self):
        lay = Layout(timing(), "minimal-stage", 24)
        self.assertEqual(lay.slot, (192, 112))
        self.assertEqual(lay.slot_size, (1536, 864))
        video = Image.new("RGB", lay.slot_size, (80, 120, 160))
        image = lay.frame(1, video)
        self.assertEqual(image.crop((208, 128, 1712, 960)).getextrema(), ((80, 80), (120, 120), (160, 160)))
        self.assertLessEqual(lay.design.BAR["cy"] + lay.design.BAR["h"] / 2, lay.slot[1])
        self.assertGreaterEqual(lay.design.CHAPTER_VIEW["cy"] - lay.design.CHAPTER_VIEW["h"] / 2,
                                lay.slot[1] + lay.slot_size[1])
        for count in (2, 12):
            first = Layout(timing(count), "minimal-stage", count * 2).frame(0)
            self.assertEqual(first.getpixel((672 if count == 2 else 72, 1035)), rgb(lay.design.BRAND["pill_active"]))
        image = lay.frame(12.4)
        self.assertEqual(lay.chapter_at(12.4), 7)
        self.assertEqual(image.getpixel((670, 1035)), rgb(lay.design.BRAND["pill_active"]))
        self.assertEqual(image.getpixel((70, 1035)), rgb(lay.design.BRAND["pill_base"]))
        self.assertEqual(image.getpixel((680, 1062)), rgb(lay.design.BRAND["accent"]))
        self.assertEqual(image.getpixel((750, 1062)), rgb(lay.design.BRAND["pill_active"]))
        self.assertEqual(image.getpixel((680, 1066)), rgb(lay.design.BRAND["canvas"]))
        self.assertEqual(image.getpixel((70, 1007)), rgb(lay.design.BRAND["canvas"]))
        self.assertEqual(image.getpixel((70, 1069)), rgb(lay.design.BRAND["canvas"]))
        self.assertEqual(lay.frame(0).tobytes(), Layout(timing(), "minimal-stage", 24).frame(0).tobytes())

    def test_minimal_stage_progress_follows_the_active_segment_and_clips_during_large_jumps(self):
        lay = Layout(timing(2), "minimal-stage", 6)
        self.assertEqual(lay.frame(1.8).getpixel((810, 1062)), rgb(lay.design.BRAND["accent"]))
        self.assertEqual(lay.frame(2).getpixel((1110, 1062)), rgb(lay.design.BRAND["pill_active"]))
        self.assertEqual(lay.frame(5.8).getpixel((1110, 1062)), rgb(lay.design.BRAND["accent"]))
        source = timing()
        for chapter in source["chapters"][1:]:
            chapter["start"] = 1
        jumped = Layout(source, "minimal-stage", 3)
        image = jumped.frame(1.3)
        self.assertEqual(image.getpixel((1854, 1062)), rgb(jumped.design.BRAND["accent"]))
        self.assertEqual(image.getpixel((1858, 1062)), rgb(jumped.design.BRAND["canvas"]))

    def test_progress_tracks_chapter_boundaries_and_the_actual_final_video_end(self):
        for theme in ("dark-rail", "minimal-stage", "cinematic"):
            with self.subTest(theme=theme):
                lay = Layout(timing(2), theme, 6)
                box = lay.design.PROGRESS
                x, y = int(lay.chapter_cx if lay.horizontal else box["cx"]), int(box["cy"])
                self.assertEqual(lay.frame(0).getpixel((x, y)), rgb(lay.design.BRAND["pill_active"]))
                self.assertEqual(lay.frame(1.8).getpixel((x, y)), rgb(lay.design.BRAND["accent"]))
                if lay.horizontal:
                    x += lay.design.PILL["pitch"]
                self.assertEqual(lay.frame(2).getpixel((x, y)), rgb(lay.design.BRAND["pill_active"]))
                self.assertEqual(lay.frame(5.8).getpixel((x, y)), rgb(lay.design.BRAND["accent"]))
                source = timing(2)
                source["chapters_end"] = 4
                capped = Layout(source, theme, 6)
                self.assertEqual(capped.frame(4).getpixel((x, y)), rgb(capped.design.BRAND["accent"]))

    def test_theme_render_cli_including_source_changes_gaps_and_preview_frames(self):
        ffmpeg = find_ffmpeg()
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            for color in ("red", "blue"):
                subprocess.run([ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i",
                                "color=c=%s:s=320x180:r=10:d=0.3" % color,
                                "-c:v", "libx264", str(directory / (color + ".mp4"))], check=True)
            project = {
                "project_version": 1, "output": {"fps": "10/1"},
                "media": [{"id": color, "path": color + ".mp4"} for color in ("red", "blue")],
                "clips": [{"id": color, "media_id": color, "start": start, "source_in": 0, "source_out": 0.2}
                          for color, start in (("red", 0), ("blue", 0.4))],
                "timing": timing(1),
            }
            for theme in ("dark-rail", "minimal-stage", "cinematic"):
                with self.subTest(theme=theme):
                    project["output"]["theme"] = theme
                    path, output, png = directory / "project.json", directory / (theme + ".mp4"), directory / (theme + ".png")
                    path.write_text(json.dumps(project))
                    result = subprocess.run([sys.executable, str(ROOT / "render/render.py"), str(path),
                                             "-o", str(output), "--preset", "veryfast"],
                                            capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    w, h, fps, duration, _ = probe(ffmpeg, output)
                    self.assertEqual((w, h, fps), (1920, 1080, 10))
                    self.assertAlmostEqual(duration, 0.6)
                    content = L.theme_layout(theme).CONTENT
                    x, y = content["cx"], content["cy"]
                    for time, expected in ((0.1, (255, 0, 0)), (0.3, (0, 0, 0)), (0.5, (0, 0, 255))):
                        frame = subprocess.run([ffmpeg, "-v", "error", "-ss", str(time), "-i", str(output),
                                                "-vf", "scale=in_color_matrix=bt709:in_range=tv:out_range=full,format=rgb24",
                                                "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                                               capture_output=True, check=True).stdout
                        self.assertEqual(len(frame), w * h * 3)
                        pixel = frame[(y * w + x) * 3:(y * w + x) * 3 + 3]
                        self.assertLessEqual(max(abs(a - b) for a, b in zip(pixel, expected)), 12, (theme, time, pixel))
                    result = subprocess.run([sys.executable, str(ROOT / "render/render.py"), str(path),
                                             "--frame", "0.1", "--png", str(png)], capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    with Image.open(png) as image:
                        self.assertEqual(image.size, (1920, 1080))
                        self.assertGreater(image.getpixel((x, y))[0], 240)
