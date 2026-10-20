"""The footage encode used by the interactive page: the clips joined, no branding, one web-friendly MP4."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "render"))
import layout as L
from render import find_ffmpeg, probe

FIXTURE = json.loads((ROOT / "tests/fixtures/project.json").read_text())


class FootageTests(unittest.TestCase):
    def make(self, directory, theme="dark-rail"):
        ffmpeg = find_ffmpeg()
        red, blue = directory / "red.mp4", directory / "blue.mp4"
        subprocess.run([ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=160x90:r=25:d=2",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-c:a", "aac", str(red)], check=True)
        subprocess.run([ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=25:d=2",
                        "-c:v", "libx264", str(blue)], check=True)
        project = copy.deepcopy(FIXTURE)
        project["output"].update(fps="25/1", theme=theme)
        project["media"] = [{"id": "red", "path": red.name}, {"id": "blue", "path": blue.name}]
        project["clips"] = [
            {"id": "a", "media_id": "red", "start": 0, "source_in": 0, "source_out": 1},
            {"id": "b", "media_id": "blue", "start": 1, "source_in": 0, "source_out": 1},
        ]
        path = directory / "project.json"
        path.write_text(json.dumps(project))
        return ffmpeg, path

    def run_footage(self, path, output, *extra):
        result = subprocess.run([sys.executable, str(ROOT / "render/render.py"), str(path), "-o", str(output), "--footage",
                                 "--preset", "veryfast", "--crf", "22", *extra], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def pixel(self, ffmpeg, video, time, size):
        raw = subprocess.run([ffmpeg, "-v", "error", "-ss", str(time), "-i", str(video),
                              "-vf", "scale=in_color_matrix=bt709:in_range=tv:out_range=full,format=rgb24",
                              "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
        x, y = size[0] // 2, size[1] // 2
        return tuple(raw[(y * size[0] + x) * 3:(y * size[0] + x) * 3 + 3])

    def test_joins_the_clips_at_the_content_size_without_any_branding(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            ffmpeg, path = self.make(directory)
            output = directory / "footage.mp4"
            self.run_footage(path, output)
            content = L.theme_layout("dark-rail").CONTENT
            width, height, fps, duration, _ = probe(ffmpeg, output)
            self.assertEqual((width, height), (content["w"], content["h"]))
            self.assertAlmostEqual(fps, 25, delta=0.1)
            self.assertAlmostEqual(duration, 2.0, delta=0.1)
            for time, expected in ((0.4, (255, 0, 0)), (1.6, (0, 0, 255))):
                pixel = self.pixel(ffmpeg, output, time, (width, height))
                self.assertLessEqual(max(abs(a - b) for a, b in zip(pixel, expected)), 20, (time, pixel))
            inspected = subprocess.run([ffmpeg, "-hide_banner", "-i", str(output)], capture_output=True, text=True).stderr
            self.assertIn("Audio: aac", inspected)
            self.assertIn("h264", inspected)

    def test_every_theme_gets_an_even_sized_picture_that_h264_accepts(self):
        for theme, size in {"classic": (1458, 820), "dark-rail": (1504, 846), "minimal-stage": None, "cinematic": None}.items():
            with self.subTest(theme=theme), tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp)
                ffmpeg, path = self.make(directory, theme)
                output = directory / "footage.mp4"
                self.run_footage(path, output)
                content = L.theme_layout(theme).CONTENT
                got = probe(ffmpeg, output)[:2]
                self.assertEqual(got[0] % 2 + got[1] % 2, 0, got)
                self.assertLessEqual(content["w"] - got[0], 1)
                self.assertLessEqual(content["h"] - got[1], 1)
                if size:
                    self.assertEqual(got, size)

    def test_no_audio_option(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            ffmpeg, path = self.make(directory)
            output = directory / "footage.mp4"
            self.run_footage(path, output, "--no-audio")
            inspected = subprocess.run([ffmpeg, "-hide_banner", "-i", str(output)], capture_output=True, text=True).stderr
            self.assertNotIn("Audio:", inspected)

    def test_refuses_to_overwrite_the_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            _, path = self.make(directory)
            result = subprocess.run([sys.executable, str(ROOT / "render/render.py"), str(path), "-o", str(path), "--footage"],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("overwrite", result.stderr)


if __name__ == "__main__":
    unittest.main()
