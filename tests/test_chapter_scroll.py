"""Chapter viewport geometry and animation."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "render"))
import layout as L
from chapter_scroll import scroll_position, scroll_steps, window_start
from layers import Layout, rgb
from render import find_ffmpeg, load_timing, probe


def timing(count=12, starts=None):
    return {
        "chapters": ["Chapter %d" % i for i in range(1, count + 1)],
        "chapter_starts": starts if starts is not None else [[(i - 1) * 2, i] for i in range(1, count + 1)],
        "headlines": [[0, "A *scrolling* demo"]],
    }


class ChapterScrollTests(unittest.TestCase):
    def test_window_has_two_previous_and_three_next(self):
        for active in range(3, 10):
            start = window_start(active, 12, 6, 2)
            self.assertEqual(active - 1 - start, 2)
            self.assertEqual(start + 6 - active, 3)
        self.assertEqual(window_start(1, 12, 6, 2), 0)
        self.assertEqual(window_start(12, 12, 6, 2), 6)

    def test_small_lists_do_not_scroll(self):
        for count in range(1, 7):
            steps = scroll_steps(timing(count)["chapter_starts"], count, L.CHAPTER_SCROLL)
            for t in (0, 1, 5, 100):
                self.assertEqual(scroll_position(t, steps, 0.4), 0)

    def test_smooth_scroll_and_random_access(self):
        steps = scroll_steps([[0, 1], [1, 7], [3, 2], [5, 12]], 12, L.CHAPTER_SCROLL)
        for t, expected in ((0, 0), (1, 0), (1.1, 0.625), (1.2, 2), (1.4, 4),
                            (3, 4), (3.2, 2), (3.4, 0), (5.4, 6), (1.2, 2)):
            self.assertAlmostEqual(scroll_position(t, steps, 0.4), expected)

    def test_interrupted_and_simultaneous_switches(self):
        steps = scroll_steps([[0, 1], [1, 7], [1.2, 12], [1.2, 4]], 12, L.CHAPTER_SCROLL)
        self.assertAlmostEqual(scroll_position(1.2, steps, 0.4), 2)
        self.assertAlmostEqual(scroll_position(1.4, steps, 0.4), 1.5)
        self.assertAlmostEqual(scroll_position(1.6, steps, 0.4), 1)
        same_target = scroll_steps([[0, 1], [1, 12], [1.1, 11]], 12, L.CHAPTER_SCROLL)
        self.assertEqual(len(same_target), 2)
        self.assertAlmostEqual(scroll_position(1.2, same_target, 0.4), 3)

    def test_first_active_chapter_is_positioned_before_first_switch(self):
        steps = scroll_steps([[10, 8]], 12, L.CHAPTER_SCROLL)
        self.assertEqual(scroll_position(0, steps, 0.4), 5)
        self.assertEqual(scroll_position(10, steps, 0.4), 5)

    def test_renderer_clips_and_centers_active_chapter(self):
        lay = Layout(timing())
        img = lay.frame(12.4)
        green, orange, white = (rgb(L.BRAND[k]) for k in ("pill_base", "pill_active", "panel"))
        for row in range(6):
            cy = 347 + row * 126
            self.assertEqual(img.getpixel((70, cy)), orange if row == 2 else green)
        self.assertEqual(img.getpixel((70, 292)), white)
        self.assertEqual(img.getpixel((70, 1032)), white)
        self.assertEqual(lay.chapter_at(12.4), 7)
        self.assertEqual(img.size, (1920, 1080))
        first = lay.frame(0).tobytes()
        lay.frame(22.4)
        self.assertEqual(lay.frame(0).tobytes(), first)

    def test_small_renderer_lists_keep_the_original_geometry(self):
        for count in range(1, 7):
            lay = Layout(timing(count))
            img = lay.frame(0)
            for i in range(1, count + 1):
                cy = 977 - (count - i) * 126
                colour = L.BRAND["pill_active"] if i == 1 else L.BRAND["pill_base"]
                self.assertEqual(img.getpixel((70, cy)), rgb(colour))
            self.assertEqual(img.crop((100, 1032, 340, 1060)).getextrema(), ((255, 255),) * 3)

    def test_renderer_moves_buttons_during_transition(self):
        lay = Layout(timing(starts=[[0, 1], [1, 7]]))
        self.assertEqual(lay.frame(1).getpixel((70, 725)), rgb(L.BRAND["pill_base"]))
        self.assertEqual(lay.frame(1.2).getpixel((70, 851)), rgb(L.BRAND["pill_active"]))
        self.assertEqual(lay.frame(1.4).getpixel((70, 599)), rgb(L.BRAND["pill_active"]))
        middle = lay.frame(1.2).tobytes()
        lay.frame(0)
        self.assertEqual(lay.frame(1.2).tobytes(), middle)

    def test_encoded_video_contains_the_scroll(self):
        ffmpeg = find_ffmpeg()
        with tempfile.TemporaryDirectory() as tmp:
            clip, output = Path(tmp) / "source.mp4", Path(tmp) / "scroll.mp4"
            subprocess.run([ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i",
                            "color=c=gray:s=320x180:r=25:d=3", "-c:v", "libx264", str(clip)], check=True)
            timing_file = Path(tmp) / "timing.json"
            # Keep all chapters scheduled while exercising the same simultaneous scroll targets.
            starts = [[0, 1]] + [[1, ch] for ch in range(2, 8)] + [[2, ch] for ch in range(8, 13)]
            timing_file.write_text(json.dumps({
                "project_version": 1, "output": {"fps": "25/1"},
                "media": [{"id": "source", "path": clip.name}],
                "clips": [{"id": "clip", "media_id": "source", "start": 0, "source_in": 0, "source_out": 3}],
                "timing": {"schema_version": 2, "chapters": [
                    {"title": "Chapter %d" % ch, "start": time, "headlines": [[0, "Scrolling"]] if i == 0 else []}
                    for i, (time, ch) in enumerate(starts)]}}))
            rendered = subprocess.run([sys.executable, str(ROOT / "render" / "render.py"), str(timing_file),
                                       "-o", str(output), "--crf", "23",
                                       "--preset", "veryfast"], capture_output=True, text=True)
            self.assertEqual(rendered.returncode, 0, rendered.stdout + rendered.stderr)
            width, height, fps, duration, _ = probe(ffmpeg, output)
            self.assertEqual((width, height, fps), (1920, 1080, 25))
            self.assertAlmostEqual(duration, 3)
            for t, cy in ((0.4, 347), (1.2, 851), (1.4, 599), (2.4, 977)):
                png = Path(tmp) / "frame.png"
                subprocess.run([ffmpeg, "-y", "-v", "error", "-ss", str(t), "-i", str(output), "-vf",
                                "scale=in_color_matrix=bt709:in_range=tv:out_range=full,format=rgb24",
                                "-frames:v", "1", str(png)], check=True)
                with Image.open(png) as img:
                    got = img.convert("RGB").getpixel((70, cy))
                want = rgb(L.BRAND["pill_active"])
                self.assertLessEqual(max(abs(a - b) for a, b in zip(got, want)), 8, (t, got))

    def test_renderer_accepts_more_than_six_and_rejects_invalid_references(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "timing.json"
            path.write_text(json.dumps(timing()))
            self.assertEqual(len(load_timing(str(path))["chapters"]), 12)
            invalid = timing()
            invalid["chapter_starts"].append([30, 13])
            path.write_text(json.dumps(invalid))
            with self.assertRaisesRegex(SystemExit, "only 1-12 exist"):
                load_timing(str(path))

    def test_renderer_converts_legacy_reuse_without_changing_source_file(self):
        source = {
            "chapters": ["Intro", "Details", "Unused"],
            "chapter_starts": [[20, 1], [0, 1], [10, 2]],
            "headlines": [[0, "A headline"]],
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "timing.json"
            path.write_text(json.dumps(source))
            with contextlib.redirect_stderr(io.StringIO()) as output:
                converted = load_timing(str(path))
            self.assertEqual(converted["chapters"], ["Intro", "Details", "Intro"])
            self.assertEqual(converted["chapter_starts"], [[0, 1], [10, 2], [20, 3]])
            self.assertIn("Converted repeated chapter switches", output.getvalue())
            self.assertIn("unused chapter titles", output.getvalue())
            self.assertEqual(json.loads(path.read_text()), source)


if __name__ == "__main__":
    unittest.main()
