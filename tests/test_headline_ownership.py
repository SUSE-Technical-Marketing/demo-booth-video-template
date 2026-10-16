"""Chapter-relative schema and renderer boundary frames."""
import contextlib
import copy
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from test_chapter_scroll import ROOT
import layout as L
from layers import Layout, fit_px, parse_headline
from render import chapter_metadata, find_ffmpeg, load_timing, probe
from timing import normalize_chapters


def owned_timing():
    return {
        "schema_version": 2,
        "chapters": [
            {"title": "Intro", "start": 0, "headlines": [[0, "First"], [8, "Last"], [12, "Outside"]]},
            {"title": "Empty", "start": 10, "headlines": []},
            {"title": "Later", "start": 20, "headlines": [[3, "Delayed"]]},
        ],
    }


class HeadlineOwnershipTests(unittest.TestCase):
    def test_encoded_chapter_end_does_not_trim_the_video(self):
        ffmpeg = find_ffmpeg()
        with tempfile.TemporaryDirectory() as tmp:
            clip, output = Path(tmp) / "source.mp4", Path(tmp) / "ended.mp4"
            subprocess.run([ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i",
                            "color=c=gray:s=320x180:r=25:d=1", "-c:v", "libx264", str(clip)], check=True)
            timing_file = Path(tmp) / "timing.json"
            timing_file.write_text(json.dumps({
                "project_version": 1, "output": {"fps": "25/1"},
                "media": [{"id": "source", "path": clip.name}],
                "clips": [{"id": "clip", "media_id": "source", "start": 0, "source_in": 0, "source_out": 1}],
                "timing": {"schema_version": 2, "chapters_end": 0.8,
                           "chapters": [{"title": "Intro", "start": 0, "headlines": [[0, "Headline"]]}]},
            }))
            rendered = subprocess.run([sys.executable, str(ROOT / "render" / "render.py"), str(timing_file),
                                       "-o", str(output),
                                       "--preset", "veryfast"], capture_output=True, text=True)
            self.assertEqual(rendered.returncode, 0, rendered.stdout + rendered.stderr)
            self.assertAlmostEqual(probe(ffmpeg, output)[3], 1)
            inspected = subprocess.run([ffmpeg, "-i", str(output), "-f", "null", "-"],
                                       capture_output=True, text=True, check=True)
            self.assertIn("start 0.000000, end 0.800000", inspected.stderr)

    def test_explicit_chapter_end_caps_headlines(self):
        source = {**owned_timing(), "chapters_end": 25}
        layout = Layout(source)
        self.assertEqual(layout.headline_at(24.99), (2, 23))
        self.assertIsNone(layout.headline_at(25))
        self.assertIsNone(layout.headline_at(30))
        bar = (layout.bar_x, layout.bar_y, layout.bar_x + L.BAR["w"], layout.bar_y + L.BAR["h"])
        self.assertEqual(layout.frame(25).crop(bar).tobytes(), layout.background().crop(bar).tobytes())

    def test_chapter_metadata_obeys_configured_end_and_partial_renders(self):
        layout = Layout({**owned_timing(), "chapters_end": 25})
        metadata = chapter_metadata(layout, 0, 40)
        self.assertIn("START=20000\nEND=25000\ntitle=Later", metadata)
        self.assertIn("START=0\nEND=3000\ntitle=Later", chapter_metadata(layout, 22, 10))
        self.assertIsNone(chapter_metadata(layout, 26, 10))
        self.assertIn("END=24000\ntitle=Later", chapter_metadata(layout, 0, 24))

    def test_missing_or_null_chapter_end_preserves_automatic_behavior(self):
        for source in (owned_timing(), {**owned_timing(), "chapters_end": None}):
            layout = Layout(source)
            self.assertEqual(layout.headline_at(50), (2, 23))
            self.assertIn("END=40000\ntitle=Later", chapter_metadata(layout, 0, 40))

    def test_invalid_chapter_ends_are_rejected(self):
        for end in (0, -1, 0.001, float("inf"), "25", True):
            with self.subTest(end=end), self.assertRaisesRegex(ValueError, "chapters_end"):
                normalize_chapters({**owned_timing(), "chapters_end": end})

    def test_schema_two_loads_with_owned_windows_and_does_not_rewrite_source(self):
        source = owned_timing()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "timing.json"
            path.write_text(json.dumps(source))
            with contextlib.redirect_stderr(io.StringIO()) as output:
                timing = load_timing(str(path))
            self.assertEqual(timing["_headline_intervals"], [(0, "First", 8), (8, "Last", 10), (23, "Delayed", None)])
            self.assertEqual(timing["chapter_starts"], [[0, 1], [10, 2], [20, 3]])
            self.assertIn("Skipped 1 headline(s)", output.getvalue())
            self.assertEqual(json.loads(path.read_text()), source)

    def test_renderer_clears_empty_and_delayed_chapters_at_exact_boundaries(self):
        layout = Layout(owned_timing())
        for time, expected in ((0, (0, 0)), (8, (1, 8)), (9.99, (1, 8)), (10, None),
                               (12, None), (19.99, None), (20, None), (22.99, None), (23, (2, 23))):
            self.assertEqual(layout.headline_at(time), expected)
        bar = (layout.bar_x, layout.bar_y, layout.bar_x + L.BAR["w"], layout.bar_y + L.BAR["h"])
        blank = layout.background().crop(bar).tobytes()
        self.assertNotEqual(layout.frame(9.99).crop(bar).tobytes(), blank)
        self.assertEqual(layout.frame(10).crop(bar).tobytes(), blank)
        self.assertEqual(layout.frame(22.99).crop(bar).tobytes(), blank)
        self.assertNotEqual(layout.frame(24).crop(bar).tobytes(), blank)

    def test_legacy_global_headlines_are_assigned_by_their_start_not_carried_forward(self):
        source = {"chapters": ["Intro", "Empty", "Later"], "chapter_starts": [[0, 1], [10, 2], [20, 3]],
                  "headlines": [[0, "First"], [8, "Last"], [23, "Delayed"]]}
        layout = Layout(source)
        self.assertEqual(layout.headline_at(9.99), (1, 8))
        self.assertIsNone(layout.headline_at(10))
        self.assertIsNone(layout.headline_at(20))
        self.assertEqual(layout.headline_at(23), (2, 23))

    def test_empty_documents_are_valid(self):
        source = {"schema_version": 2, "chapters": [{"title": "Empty", "start": 0, "headlines": []}]}
        layout = Layout(source)
        self.assertIsNone(layout.headline_at(5))
        self.assertEqual(layout.frame(5).size, (1920, 1080))
        legacy = {"chapters": ["Empty"], "chapter_starts": [[0, 1]], "headlines": []}
        self.assertIsNone(Layout(legacy).headline_at(5))

    def test_global_end_zero_and_finite_cutoffs_remain_supported(self):
        for end in (0, 24):
            source = {**owned_timing(), "headlines_end": end}
            layout = Layout(source)
            self.assertIsNone(layout.headline_at(end))

    def test_negative_offsets_are_retained_as_data_but_never_shown(self):
        source = {"schema_version": 2, "chapters": [{"title": "Intro", "start": 10, "headlines": [[-5, "Early"]]}]}
        timing = copy.deepcopy(source)
        self.assertIn("Skipped 1 headline(s)", normalize_chapters(timing))
        self.assertEqual(timing["headlines"], [[5, "Early"]])
        self.assertEqual(timing["_headline_intervals"], [])
        self.assertIsNone(Layout(source).headline_at(20))

    def test_shared_text_size_still_accounts_for_all_editable_headlines(self):
        source = owned_timing()
        source["chapters"][0]["headlines"][2][1] = "Long outside headline " * 20
        layout = Layout(source)
        plains = ["".join(run for run, _ in parse_headline(text))
                  for chapter in source["chapters"] for _, text in chapter["headlines"]]
        self.assertEqual(layout.hl_px, fit_px(plains, L.HEADLINE_PX * L.TEXT_SCALE, L.HEADLINE_MAX_W))

    def test_invalid_nested_documents_are_rejected_explicitly(self):
        for source in (
            {"schema_version": 3, "chapters": []},
            {"schema_version": 2, "chapters": [{"title": "Bad", "start": -1, "headlines": []}]},
            {"schema_version": 2, "chapters": [{"title": "Bad", "start": 0, "headlines": [[float("nan"), "Text"]]}]},
            {"schema_version": 2, "chapters": [{"title": "Bad", "start": 0, "headlines": [[0, ""]]}]},
        ):
            with self.subTest(source=source), self.assertRaises(ValueError):
                normalize_chapters(source)


    def test_explicit_headline_end_leaves_a_gap_before_the_next_headline(self):
        source = {"schema_version": 2, "chapters": [
            {"title": "Intro", "start": 10, "headlines": [[0, "First", 5], [8, "Second"], [12, "Third", None]]}]}
        layout = Layout(source)
        self.assertEqual(layout.headline_at(14.99), (0, 10))
        self.assertIsNone(layout.headline_at(15))             # the words end here, before "Second" starts
        self.assertIsNone(layout.headline_at(17.99))
        self.assertEqual(layout.headline_at(18), (1, 18))
        self.assertEqual(layout.headline_at(22), (2, 22))     # null end behaves like no end
        timing = copy.deepcopy(source)
        normalize_chapters(timing)
        self.assertEqual(timing["_headline_intervals"], [(10, "First", 15), (18, "Second", 22), (22, "Third", None)])
        self.assertEqual(timing["headlines"], [[10, "First"], [18, "Second"], [22, "Third"]])

    def test_explicit_end_cannot_extend_past_the_next_headline_or_chapter(self):
        source = {"schema_version": 2, "chapters": [
            {"title": "A", "start": 0, "headlines": [[0, "One", 50], [10, "Two", 99]]},
            {"title": "B", "start": 20, "headlines": []}]}
        layout = Layout(source)
        self.assertIsNone(layout.headline_at(20))
        self.assertEqual(layout.headline_at(9.99), (0, 0))
        self.assertEqual(layout.headline_at(10), (1, 10))

    def test_an_explicit_end_must_come_after_its_start(self):
        for row in ([5, "Text", 5], [5, "Text", 2], [5, "Text", "9"], [5, "Text", float("inf")], [5, "Text", 9, 10]):
            with self.subTest(row=row), self.assertRaises(ValueError):
                normalize_chapters({"schema_version": 2, "chapters": [{"title": "A", "start": 0, "headlines": [row]}]})


if __name__ == "__main__":
    unittest.main()
