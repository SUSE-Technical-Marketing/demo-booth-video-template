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
from project import load_project, project_fps, timeline_segments, validate_project
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
        ]:
            project = copy.deepcopy(FIXTURE)
            target = project
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            with self.subTest(path=path, value=value), self.assertRaises(ValueError):
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
            path.write_text(json.dumps(FIXTURE))
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
            self.assertEqual(load_project(path)[0], FIXTURE)

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
