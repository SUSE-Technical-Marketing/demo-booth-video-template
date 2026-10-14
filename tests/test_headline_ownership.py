"""Chapter-relative schema, renderer boundary frames and Fusion visibility windows."""
import contextlib
import copy
import io
import json
import os
from pathlib import Path
import runpy
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from test_chapter_scroll import FakeComp, ROOT, expression_value
import layout as L
from layers import Layout, fit_px, parse_headline
from render import load_timing
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


def build_fusion(source):
    with tempfile.TemporaryDirectory() as tmp:
        repo = Path(tmp)
        (repo / "assets").mkdir()
        (repo / "assets" / "SUSE_Logo-hor_Green.png").touch()
        (repo / "timings").mkdir()
        (repo / "timings" / "example.json").write_text(json.dumps(source))
        comp = FakeComp()
        with patch.dict(os.environ, {"DEMO_BOOTH_REPO": tmp}), contextlib.redirect_stdout(io.StringIO()) as output:
            result = runpy.run_path(str(ROOT / "fusion" / "build_chapter_template.py"),
                                   init_globals={"fu": SimpleNamespace(GetCurrentComp=lambda: comp)})
        return comp, result, output.getvalue()


class HeadlineOwnershipTests(unittest.TestCase):
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

    def test_empty_documents_are_valid_in_both_renderers(self):
        source = {"schema_version": 2, "chapters": [{"title": "Empty", "start": 0, "headlines": []}]}
        layout = Layout(source)
        self.assertIsNone(layout.headline_at(5))
        self.assertEqual(layout.frame(5).size, (1920, 1080))
        comp, result, _ = build_fusion(source)
        self.assertEqual(result["HEADLINES"], [])
        self.assertIsNone(comp.FindTool("HeadlineWipe1"))
        self.assertIsNotNone(comp.FindTool("MediaOut1"))
        legacy = {"chapters": ["Empty"], "chapter_starts": [[0, 1]], "headlines": []}
        self.assertIsNone(Layout(legacy).headline_at(5))

    def test_fusion_windows_match_renderer_and_do_not_build_invalid_headlines(self):
        source = owned_timing()
        comp, result, notice = build_fusion(source)
        layout = Layout(source)
        self.assertEqual(result["HEADLINE_ENDS"], [8, 10, None])
        self.assertIn("Skipped 1 headline(s)", notice)
        self.assertIsNone(comp.FindTool("HeadlineWipe4"))
        for time in (0, 7.96, 8, 9.96, 10, 12, 20, 22.96, 23, 24):
            visible = [i for i in range(3) if comp.FindTool("H%d_Merge1" % (i + 1)).GetInput("Blend", 100 + time * 25)]
            selected = layout.headline_at(time)
            self.assertEqual(visible, [] if selected is None else [selected[0]])

    def test_global_end_zero_and_finite_cutoffs_remain_supported(self):
        for end in (0, 24):
            source = {**owned_timing(), "headlines_end": end}
            layout = Layout(source)
            self.assertIsNone(layout.headline_at(end))
            comp, result, _ = build_fusion(source)
            if end == 0:
                self.assertEqual(result["HEADLINES"], [])
            else:
                self.assertEqual(comp.FindTool("H3_Merge1").GetInput("Blend", 100 + 23 * 25), 1)
                self.assertEqual(comp.FindTool("H3_Merge1").GetInput("Blend", 100 + end * 25), 0)

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
        plains = [" ".join(word for word, _ in parse_headline(text))
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


if __name__ == "__main__":
    unittest.main()
