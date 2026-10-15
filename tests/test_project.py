"""Shared project fixtures, hard cuts, trims, gaps, audio and final MP4 output."""

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from array import array

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "render"))
import layout as L
from PIL import Image
from project import load_project, project_fps, project_resolution, resolve_media_path, timeline_segments, validate_project
from render import find_ffmpeg, probe

FIXTURE = json.loads((ROOT / "tests/fixtures/project.json").read_text())


class ProjectTests(unittest.TestCase):
    def test_shared_fixture_and_frame_plan(self):
        project = copy.deepcopy(FIXTURE)
        self.assertIs(validate_project(project), project)
        self.assertEqual(project, FIXTURE)
        segments = timeline_segments(project)
        self.assertEqual([s["frames"] for s in segments], [5, 25, 10, 20])
        self.assertAlmostEqual(segments[1]["source_start"], 0.4)
        self.assertAlmostEqual(float(project_fps("30000/1001")), 29.97002997)

    def test_invalid_projects(self):
        for path, value in [
            (("project_version",), True), (("output",), None), (("output", "fps"), "0/1"),
            (("media", 0, "path"), "/absolute.mp4"), (("media", 0, "path"), "blob:local"),
            (("media", 0, "path"), "C:\\video.mp4"), (("media", 1, "id"), "red"),
            (("clips", 0, "media_id"), []), (("clips", 0, "start"), float("inf")),
            (("clips", 0, "source_out"), 0.4), (("clips", 1, "start"), 1),
            (("clips", 0, "transition_in"), {"type": "crossfade"}),
            (("output", "resolution"), "1920x1081"), (("output", "resolution"), "0x0"),
            (("output", "resolution"), "7682x4320"), (("output", "resolution"), "1280 x 720"),
            (("output", "resolution"), 1080), (("output", "resolution"), [1280, 720]),
        ]:
            project = copy.deepcopy(FIXTURE)
            target = project
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            with self.subTest(path=path, value=value), self.assertRaises(ValueError):
                validate_project(project)

    def test_media_folder_base_does_not_get_baked_into_relative_paths(self):
        for folder in ("", ".", "./", "media", "media/", "./media//demos/", "../shared videos", "media/\u89c6\u9891"):
            project = copy.deepcopy(FIXTURE)
            project["media_folder"] = folder
            for item in project["media"]:
                item["path"] = item["path"].removeprefix("media/")
            relative_media = copy.deepcopy(project["media"])
            with self.subTest(folder=folder):
                self.assertIs(validate_project(project), project)
                self.assertEqual(project["media_folder"], folder)
                self.assertEqual(project["media"], relative_media)

    def test_media_paths_resolve_relative_to_the_media_folder(self):
        for path, folder, expected in [
            ("demo clip.mp4", "media", "media/demo clip.mp4"),
            ("demo clip.mp4", "./media//nested/", "media/nested/demo clip.mp4"),
            ("demo clip.mp4", "../shared videos/", "../shared videos/demo clip.mp4"),
            ("demo clip.mp4", "media/\u89c6\u9891", "media/\u89c6\u9891/demo clip.mp4"),
            ("demo clip.mp4", "", "demo clip.mp4"),
            ("demo clip.mp4", ".", "demo clip.mp4"),
            ("nested/demo.mp4", "media", "media/nested/demo.mp4"),
            ("media/demo.mp4", "media", "media/media/demo.mp4"),
            ("../shared/demo.mp4", "media", "media/../shared/demo.mp4"),
        ]:
            with self.subTest(path=path, folder=folder):
                self.assertEqual(resolve_media_path(path, folder), expected)
        self.assertEqual(resolve_media_path("media/demo.mp4"), "media/demo.mp4")
        for path in ("", "/absolute.mp4", "C:/video.mp4", "video\\file.mp4"):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "Media path must be a relative path"):
                resolve_media_path(path, "media")

    def test_invalid_media_folders(self):
        for folder in (None, False, 42, {}, [], " ", "/media", "//server/media", "C:/media",
                       "https://example.com/media", "./C:/media", "./https://example.com",
                       "media\\videos", "media\0", "media\n", "media\r"):
            project = copy.deepcopy(FIXTURE)
            project["media_folder"] = folder
            with self.subTest(folder=folder), self.assertRaisesRegex(ValueError, "Media folder must be a relative path"):
                validate_project(project)

    def test_render_multiple_sources_with_trims_gaps_and_missing_audio(self):
        ffmpeg = find_ffmpeg()
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "project with spaces"
            media = directory / "media"
            media.mkdir(parents=True)
            first, second = media / "one.mp4", media / "two with spaces.mp4"
            subprocess.run([ffmpeg, "-y", "-v", "error",
                            "-f", "lavfi", "-i", "color=c=yellow:s=320x180:r=25:d=0.4",
                            "-f", "lavfi", "-i", "color=c=red:s=320x180:r=25:d=1.2",
                            "-f", "lavfi", "-i", "sine=frequency=440:duration=1.6",
                            "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
                            "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-c:a", "aac", str(first)], check=True)
            subprocess.run([ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i",
                            "color=c=blue:s=640x360:r=30:d=1", "-c:v", "libx264", str(second)], check=True)
            path = directory / "project.json"
            project = copy.deepcopy(FIXTURE)
            project["media_folder"] = "media"
            for item in project["media"]:
                item["path"] = item["path"].removeprefix("media/")
            path.write_text(json.dumps(project))
            output = directory / "final.mp4"
            result = subprocess.run([sys.executable, str(ROOT / "render/render.py"), str(path),
                                     "-o", str(output), "--preset", "veryfast", "--crf", "18"],
                                    cwd=tmp, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            w, h, fps, duration, _ = probe(ffmpeg, output)
            self.assertEqual((w, h, fps), (1920, 1080, 25))
            self.assertAlmostEqual(duration, 2.4, places=2)
            x, y = L.CONTENT["cx"], L.CONTENT["cy"]
            for time, expected in [(0.08, (0, 0, 0)), (0.6, (255, 0, 0)), (1.4, (0, 0, 0)), (1.9, (0, 0, 255))]:
                frame = subprocess.run([ffmpeg, "-v", "error", "-ss", str(time), "-i", str(output),
                                        "-vf", "scale=in_color_matrix=bt709:in_range=tv:out_range=full,format=rgb24",
                                        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                                       capture_output=True, check=True).stdout
                pixel = frame[(y * w + x) * 3:(y * w + x) * 3 + 3]
                self.assertLessEqual(max(abs(a - b) for a, b in zip(pixel, expected)), 12, (time, pixel))
            for start, audible in [(0.04, False), (0.5, True), (1.3, False), (1.8, False)]:
                audio = subprocess.run([ffmpeg, "-v", "error", "-ss", str(start), "-i", str(output),
                                        "-t", "0.08", "-vn", "-ac", "1", "-ar", "48000", "-f", "s16le", "-"],
                                       capture_output=True, check=True).stdout
                samples = array("h", audio)
                rms = (sum(v * v for v in samples) / len(samples)) ** 0.5
                self.assertGreater(rms, 500) if audible else self.assertLess(rms, 50)
            metadata = subprocess.run([ffmpeg, "-i", str(output)], capture_output=True, text=True).stderr
            self.assertIn("start 1.600000, end 2.400000", metadata)
            self.assertEqual(load_project(path)[0], project)

    def test_output_cannot_overwrite_media_inside_the_configured_base(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            media = directory / "recordings"
            media.mkdir()
            source = media / "source.mp4"
            original = b"source media must not be overwritten"
            source.write_bytes(original)
            project = copy.deepcopy(FIXTURE)
            project["media_folder"] = "recordings"
            project["media"] = [{"id": "blue", "path": source.name}]
            project["clips"] = [{"id": "clip", "media_id": "blue", "start": 0, "source_in": 0, "source_out": 1}]
            path = directory / "project.json"
            path.write_text(json.dumps(project))
            result = subprocess.run([sys.executable, str(ROOT / "render/render.py"), str(path), "-o", str(source)],
                                    cwd=tmp, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("must not overwrite", result.stderr)
            self.assertEqual(source.read_bytes(), original)

    def test_output_settings_precedence(self):
        """Frame rate and size each come from the command line, else the project, else the defaults.
        Also letterboxing for non-16:9 sizes and PNG previews at the output size."""
        self.assertEqual(project_resolution(None), (1920, 1080))
        self.assertEqual(project_resolution("1280x720"), (1280, 720))
        project = copy.deepcopy(FIXTURE)
        del project["output"]["fps"]                   # the editor always writes fps; hand-written files may not
        self.assertIs(validate_project(project), project)
        self.assertEqual([s["frames"] for s in timeline_segments(project)], [5, 25, 10, 20])
        ffmpeg = find_ffmpeg()
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            media = directory / "recordings"
            media.mkdir()
            source = media / "source.mp4"
            subprocess.run([ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i",
                            "color=c=blue:s=160x90:r=25:d=1", "-c:v", "libx264", str(source)], check=True)
            project = copy.deepcopy(FIXTURE)
            project["output"]["resolution"] = "640x360"
            project["media_folder"] = "recordings"
            project["media"] = [{"id": "blue", "path": source.name}]
            project["clips"] = [{"id": "clip", "media_id": "blue", "start": 0, "source_in": 0, "source_out": 1}]
            path = directory / "project.json"
            path.write_text(json.dumps(project))
            render = lambda *options: subprocess.run(
                [sys.executable, str(ROOT / "render/render.py"), str(path), "--preset", "veryfast", *options],
                capture_output=True, text=True)
            for name, options, expected, count in [
                    ("project.mp4", [], (640, 360, 25), 25),                           # project resolution
                    ("cli.mp4", ["--size", "480x270", "--fps", "50"], (480, 270, 50), 50),  # command line wins
                    ("square.mp4", ["--size", "300x300"], (300, 300, 25), 25),
                    ("part.mp4", ["--fps", "5", "--duration", "0.6"], (640, 360, 5), 3)]:
                output = directory / name
                result = render("-o", str(output), *options)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(probe(ffmpeg, output)[:3], expected, name)
                frames = subprocess.run([ffmpeg, "-v", "error", "-i", str(output), "-an", "-f", "rawvideo",
                                         "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
                self.assertEqual(len(frames) // (expected[0] * expected[1] * 3), count, name)
                if name == "square.mp4":           # 16:9 composition letterboxed in a square: black above and below
                    top, middle = frames[:3], frames[(150 * 300 + 150) * 3:(150 * 300 + 150) * 3 + 3]
                    self.assertLessEqual(max(top), 20, top)
                    self.assertGreater(max(middle), 60, middle)
            metadata = subprocess.run([ffmpeg, "-i", str(directory / "project.mp4")], capture_output=True, text=True).stderr
            self.assertIn("Chapter #0:0", metadata)
            png = directory / "frame.png"
            self.assertEqual(render("--frame", "0.5", "--png", str(png)).returncode, 0)
            with Image.open(png) as image:
                self.assertEqual(image.size, (640, 360))
            self.assertEqual(render("--frame", "0.5", "--png", str(png), "--size", "320x180").returncode, 0)
            with Image.open(png) as image:
                self.assertEqual(image.size, (320, 180))
            for options, message in [(["--size", "1281x720"], "even sizes"), (["--size", "wide"], "WIDTHxHEIGHT"),
                                     (["--fps", "500"], "between 1 and 120"), (["--fps", "fast"], "fraction")]:
                result = render(*options)
                self.assertNotEqual(result.returncode, 0, options)
                self.assertIn(message, result.stderr, options)
            self.assertEqual(load_project(path)[0], project)
            # defaults: no fps or resolution in the file -> 25 fps, 1920x1080
            project["output"] = {}
            path.write_text(json.dumps(project))
            self.assertEqual(render().returncode, 0)
            self.assertEqual(probe(ffmpeg, directory / "project-branded.mp4")[:3], (1920, 1080, 25))

    def test_missing_media_reports_path_without_writing_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "project.json"
            path.write_text(json.dumps(FIXTURE))
            result = subprocess.run([sys.executable, str(ROOT / "render/render.py"), str(path)],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Missing media", result.stderr)
            self.assertFalse(path.with_name("project-branded.mp4").exists())

    def test_fractional_frame_rate_and_partial_render_have_exact_frame_counts(self):
        ffmpeg = find_ffmpeg()
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            source = directory / "source.mp4"
            subprocess.run([ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i",
                            "color=c=blue:s=160x90:r=30:d=1", "-c:v", "libx264", str(source)], check=True)
            project = copy.deepcopy(FIXTURE)
            project["output"]["fps"] = "30000/1001"
            project["media"] = [{"id": "blue", "path": source.name}]
            project["clips"] = [{"id": "clip", "media_id": "blue", "start": 0.2, "source_in": 0.1, "source_out": 0.9}]
            path = directory / "project.json"
            path.write_text(json.dumps(project))
            for name, options, expected in [("full", [], 30), ("part", ["--start", "0.2002", "--duration", "0.4004"], 12)]:
                output = directory / (name + ".mp4")
                rendered = subprocess.run([sys.executable, str(ROOT / "render/render.py"), str(path), "-o", str(output),
                                           "--preset", "veryfast", *options], capture_output=True, text=True)
                self.assertEqual(rendered.returncode, 0, rendered.stdout + rendered.stderr)
                frames = subprocess.run([ffmpeg, "-v", "error", "-i", str(output), "-an",
                                         "-vf", "scale=16:16", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                                        capture_output=True, check=True).stdout
                self.assertEqual(len(frames) // (16 * 16 * 3), expected, name)

    def test_short_source_and_overwriting_inputs_fail_explicitly(self):
        ffmpeg = find_ffmpeg()
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            source = directory / "source.mp4"
            subprocess.run([ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i",
                            "color=c=blue:s=160x90:r=25:d=0.2", "-c:v", "libx264", str(source)], check=True)
            project = copy.deepcopy(FIXTURE)
            project["media"] = [{"id": "blue", "path": source.name}]
            project["clips"] = [{"id": "clip", "media_id": "blue", "start": 0, "source_in": 0, "source_out": 1}]
            path = directory / "project.json"
            path.write_text(json.dumps(project))
            for options, message in [([], "Source out exceeds"), (["-o", str(source)], "must not overwrite")]:
                result = subprocess.run([sys.executable, str(ROOT / "render/render.py"), str(path), *options],
                                        capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr)
            self.assertEqual(load_project(path)[0], project)
