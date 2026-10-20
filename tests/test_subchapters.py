"""Sub-chapters: a chapter with level 1 belongs to the chapter before it."""
from pathlib import Path
import sys
import unittest

from PIL import ImageChops

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "render"))
import layout as L
from chapter_scroll import labels, parents, scroll_steps, visible_rows
from layers import Layout
from render import chapter_metadata
from timing import normalize_chapters

ROWS = [("Intro", 0), ("Blueprints", 0), ("Install", 1), ("Create", 1), ("Observe", 0), ("Traces", 0)]


def project(levels=ROWS):
    return {"schema_version": 2, "product_name": "P", "chapters": [
        {"title": title, "start": i * 10, **({"level": level} if level else {}),
         "headlines": [[0, "Headline for *%s*" % title]]} for i, (title, level) in enumerate(levels)]}


def layout(theme="dark-rail", levels=ROWS):
    return Layout(project(levels), theme=theme, duration=70)


class RowTests(unittest.TestCase):
    levels = [level for _, level in ROWS]

    def test_numbering_and_parents(self):
        self.assertEqual(labels(self.levels), ["01", "02", "2.1", "2.2", "03", "04"])
        self.assertEqual(parents(self.levels), [1, 2, 2, 2, 5, 6])

    def test_only_the_playing_chapters_sub_chapters_are_listed(self):
        self.assertEqual(visible_rows(self.levels, 1), [1, 2, 5, 6])
        self.assertEqual(visible_rows(self.levels, 2), [1, 2, 3, 4, 5, 6])
        self.assertEqual(visible_rows(self.levels, 4), [1, 2, 3, 4, 5, 6])      # while a sub-chapter plays, its chapter stays open
        self.assertEqual(visible_rows(self.levels, 5), [1, 2, 5, 6])

    def test_a_change_of_list_jumps_instead_of_scrolling(self):
        starts = [(i * 10.0, i + 1) for i in range(len(self.levels))]
        flat = scroll_steps(starts, 6, {"visible": 3, "previous": 1, "seconds": 0.4})
        nested = scroll_steps(starts, 6, {"visible": 3, "previous": 1, "seconds": 0.4}, self.levels)
        self.assertGreaterEqual(len(flat), 1)
        for start, origin, target in nested:
            if start == 10.0:          # chapter 2 opens: new list, so no animation from the old offset
                self.assertEqual(origin, target)

    def test_flat_levels_scroll_like_before(self):
        starts = [(i * 2.0, i + 1) for i in range(12)]
        settings = L.theme_layout("classic").CHAPTER_SCROLL
        self.assertEqual(scroll_steps(starts, 12, settings), scroll_steps(starts, 12, settings, [0] * 12))


class TimingTests(unittest.TestCase):
    def test_levels_reach_the_renderer_arrays(self):
        timing = project()
        normalize_chapters(timing)
        self.assertEqual(timing["chapter_levels"], [0, 0, 1, 1, 0, 0])

    def test_the_first_chapter_cannot_be_a_sub_chapter(self):
        timing = project([("A", 1), ("B", 0)])
        self.assertIn("first chapter", normalize_chapters(timing))
        self.assertEqual(timing["chapter_levels"], [0, 0])

    def test_bad_level_is_rejected(self):
        timing = project()
        timing["chapters"][2]["level"] = 2
        with self.assertRaises(ValueError):
            normalize_chapters(timing)


class DrawingTests(unittest.TestCase):
    def test_counter_counts_chapters_not_sub_chapters(self):
        lay = layout()
        self.assertEqual(lay.chapter_number(1), (1, 4))
        self.assertEqual(lay.chapter_number(3), (2, 4))
        self.assertEqual(lay.chapter_number(5), (3, 4))

    def test_opening_a_chapter_changes_the_agenda(self):
        for theme in ("dark-rail", "classic"):
            lay = layout(theme)
            closed, opened = lay.frame(5), lay.frame(25)
            self.assertIsNotNone(ImageChops.difference(closed, opened).getbbox(), theme)

    def test_moving_between_sub_chapters_changes_the_highlight_only_in_the_agenda(self):
        lay = layout("classic")
        view = L.theme_layout("classic").CHAPTER_VIEW
        box = (view["cx"] - view["w"] // 2, view["cy"] - view["h"] // 2, view["cx"] + view["w"] // 2, view["cy"] + view["h"] // 2)
        first, second = lay.frame(25), lay.frame(35)
        self.assertIsNotNone(ImageChops.difference(first.crop(box), second.crop(box)).getbbox())

    def test_themes_without_sub_chapters_draw_a_flat_list(self):
        for theme in ("minimal-stage", "cinematic"):
            nested, flat = layout(theme), layout(theme, [(t, 0) for t, _ in ROWS])
            self.assertEqual(nested.levels, [0] * 6)
            self.assertIsNone(ImageChops.difference(nested.frame(25), flat.frame(25)).getbbox(), theme)

    def test_projects_without_sub_chapters_are_unchanged_by_the_nesting_code(self):
        lay = layout("dark-rail", [(t, 0) for t, _ in ROWS])
        self.assertFalse(lay.nested)
        self.assertEqual(lay.chapter_number(3), (3, 6))

    def test_progress_line_runs_through_the_chapter_and_its_sub_chapters(self):
        lay = layout()
        self.assertEqual(lay.span(3), (10.0, 40.0))
        self.assertEqual(lay.span(4), (10.0, 40.0))
        self.assertEqual(lay.span(5), (40.0, 50.0))

    def test_mp4_chapters_are_flat_and_name_their_chapter(self):
        text = chapter_metadata(layout(), 0, 70)
        self.assertIn("title=Intro\n", text)
        self.assertIn("title=Blueprints\n", text)
        self.assertIn("title=Blueprints › Install\n", text)
        self.assertIn("title=Blueprints › Create\n", text)
        self.assertIn("title=Observe\n", text)


if __name__ == "__main__":
    unittest.main()
