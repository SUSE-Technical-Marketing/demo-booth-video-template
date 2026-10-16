"""The local export service: project + uploads, rendering through render_project, progress, download, cancel, guards."""
import copy
import http.client
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "render"))
import server
from render import find_ffmpeg, probe

H = {"X-Booth-Export": "1"}
PROJECT = {
    "project_version": 1, "output": {"fps": "25/1", "resolution": "1920x1080", "theme": "classic"},
    "media_folder": "recordings/day 1",
    "media": [{"id": "ma", "path": "takes/a.mp4"}, {"id": "mb", "path": "b.mp4"}, {"id": "unused", "path": "z.mp4"}],
    "clips": [{"id": "ca", "media_id": "ma", "start": 0, "source_in": 0, "source_out": 2},
              {"id": "cb", "media_id": "mb", "start": 3, "source_in": 0, "source_out": 2}],
    "timing": {"schema_version": 2, "title": "Export test", "product_name": "Self test",
               "chapters": [{"title": "Intro", "start": 0, "headlines": [[0, "First *headline*"]]},
                            {"title": "Details", "start": 3, "headlines": [[0, "Second"]]}]},
}


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ffmpeg = find_ffmpeg()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.httpd = server.make_server(0)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.clip = {}
        for name, audio in (("a", True), ("b", False)):
            path = Path(cls.tmp.name) / (name + ".mp4")
            cmd = [cls.ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=2"]
            if audio:
                cmd += ["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "aac"]
            subprocess.run(cmd + ["-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)], check=True)
            cls.clip[name] = path

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        for job_id in list(cls.httpd.service.jobs):
            cls.httpd.service.remove(job_id)
        cls.tmp.cleanup()

    def call(self, method, path, body=None, headers=H, raw=None, host=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=120)
        hdrs = dict(headers)
        if host:
            hdrs["Host"] = host
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        conn.request(method, path, body=data, headers=hdrs)
        res = conn.getresponse()
        payload = res.read()
        conn.close()
        return res.status, res, payload

    def json(self, *args, **kwargs):
        status, _, payload = self.call(*args, **kwargs)
        return status, json.loads(payload)

    def create(self, project=PROJECT, upload=("a", "b"), **extra):
        status, data = self.json("POST", "/api/jobs", {"project": project, "size": "1280x720", "quality": "draft", **extra})
        self.assertEqual(status, 201, data)
        self.tokens = getattr(self, "tokens", {})
        self.tokens[data["id"]] = data["token"]
        for slot, name in enumerate(upload):
            status, data2 = self.json("PUT", "/api/jobs/%s/media/%d" % (data["id"], slot), raw=self.clip[name].read_bytes())
            self.assertEqual(status, 200, data2)
        return data

    def wait(self, job_id, until=("done", "error", "cancelled"), timeout=180):
        end = time.time() + timeout
        while time.time() < end:
            status, view = self.json("GET", "/api/jobs/" + job_id)
            if view["status"] in until:
                return view
            time.sleep(0.2)
        self.fail("export did not finish: %s" % view)

    # ---- guards ----
    def test_requires_the_editor_header_and_a_local_host(self):
        self.assertEqual(self.call("GET", "/api/info", headers={})[0], 403)
        self.assertEqual(self.call("GET", "/api/info", host="evil.example:8766")[0], 403)
        status, info = self.json("GET", "/api/info")
        self.assertEqual(status, 200)
        self.assertEqual(info["qualities"], ["draft", "standard", "high"])

    def test_rejects_bad_requests_before_any_upload(self):
        no_clips = {**copy.deepcopy(PROJECT), "clips": []}
        bad_media = copy.deepcopy(PROJECT)
        bad_media["media"][0]["path"] = "/etc/passwd"
        for patch in ({"size": "1281x721"}, {"size": "huge"}, {"quality": "ultra"}, {"project": no_clips},
                      {"project": bad_media}, {"project": {"timing": {}}}, {"project": None},
                      {"audio": "false"}, {"audio": 0}, {"audio": None}):
            status, data = self.json("POST", "/api/jobs", {"project": PROJECT, **patch})
            self.assertEqual(status, 400, patch)
            self.assertIn("error", data)
        self.assertEqual(self.call("POST", "/api/jobs", raw=b"not json")[0], 400)
        self.assertEqual(self.json("GET", "/api/jobs/nope")[0], 404)

    def test_cannot_start_until_every_video_is_uploaded(self):
        data = self.create(upload=("a",))
        self.assertEqual(data["media"], ["ma", "mb"])             # the unused media is not asked for
        self.assertEqual(data["names"], ["a.mp4", "b.mp4"])
        status, body = self.json("POST", "/api/jobs/%s/start" % data["id"])
        self.assertEqual(status, 409)
        self.assertIn("b.mp4", body["error"])
        self.assertEqual(self.json("PUT", "/api/jobs/%s/media/5" % data["id"], raw=b"x")[0], 400)

    # ---- the real thing ----
    def test_a_project_with_a_gap_becomes_one_720p_video_with_chapter_markers(self):
        job = self.create(filename="My Demo")["id"]
        self.assertEqual(self.json("POST", "/api/jobs/%s/start" % job)[0], 200)
        view = self.wait(job)
        self.assertEqual(view["status"], "done", view)
        self.assertEqual(view["filename"], "My Demo.mp4")
        status, res, payload = self.call("GET", "/api/jobs/%s/download" % job)
        self.assertEqual(status, 200)
        self.assertEqual(res.getheader("Content-Type"), "video/mp4")
        out = Path(self.tmp.name) / "out.mp4"
        out.write_bytes(payload)
        w, h, fps, dur, _ = probe(self.ffmpeg, out)
        self.assertEqual((w, h), (1280, 720))
        self.assertAlmostEqual(dur, 5, delta=0.3)                 # 2 s clip, 1 s black gap, 2 s clip
        info = subprocess.run([self.ffmpeg, "-i", str(out)], capture_output=True, text=True).stderr
        self.assertIn("Audio:", info)
        self.assertIn("title           : Intro", info)
        self.assertIn("title           : Details", info)
        token = self.tokens[job]
        self.assertEqual(self.call("GET", "/api/jobs/%s/download?token=%s" % (job, token), headers={})[0], 200)
        self.assertEqual(self.call("GET", "/api/jobs/%s/download?token=nope" % job, headers={})[0], 403)
        self.assertEqual(self.call("GET", "/api/jobs/%s/download" % job, headers={})[0], 403)
        self.assertEqual(self.call("GET", "/api/jobs/%s" % job, headers={})[0], 403)    # the token opens only the download
        self.assertEqual(self.json("DELETE", "/api/jobs/" + job)[1], {"removed": True})

    def test_export_without_audio_has_no_audio_stream_and_keeps_video_and_chapters(self):
        job = self.create(audio=False, size="640x360")["id"]
        self.assertFalse(self.httpd.service.get(job).options["audio"])
        self.json("POST", "/api/jobs/%s/start" % job)
        view = self.wait(job)
        self.assertEqual(view["status"], "done", view)
        out = Path(self.tmp.name) / "without-audio.mp4"
        out.write_bytes(self.call("GET", "/api/jobs/%s/download" % job)[2])
        w, h, fps, duration, _ = probe(self.ffmpeg, out)
        self.assertEqual((w, h, fps), (640, 360, 25))
        self.assertAlmostEqual(duration, 5, delta=0.1)
        info = subprocess.run([self.ffmpeg, "-i", str(out)], capture_output=True, text=True).stderr
        self.assertIn("Video:", info)
        self.assertNotIn("Audio:", info)
        self.assertIn("title           : Intro", info)
        self.assertIn("title           : Details", info)

    def test_the_export_size_overrides_the_project_and_defaults_to_it(self):
        project = copy.deepcopy(PROJECT)
        project["output"]["resolution"] = "960x540"
        job = self.create(project, size=None)["id"]
        self.json("POST", "/api/jobs/%s/start" % job)
        view = self.wait(job)
        self.assertEqual(view["status"], "done", view)
        out = Path(self.tmp.name) / "default-size.mp4"
        out.write_bytes(self.call("GET", "/api/jobs/%s/download" % job)[2])
        self.assertEqual(probe(self.ffmpeg, out)[:2], (960, 540))

    def test_progress_is_reported_while_rendering(self):
        job = self.create()["id"]
        self.json("POST", "/api/jobs/%s/start" % job)
        view = self.wait(job, until=("done", "error", "cancelled"))
        self.assertEqual(view["status"], "done", view)
        self.assertEqual(view["progress"], 1.0)
        self.assertGreater(view["size"], 1000)

    def test_a_render_failure_is_reported_not_fatal(self):
        data = self.create(upload=())
        for slot in range(2):                       # not videos at all
            self.json("PUT", "/api/jobs/%s/media/%d" % (data["id"], slot), raw=b"this is not a video")
        self.json("POST", "/api/jobs/%s/start" % data["id"])
        view = self.wait(data["id"])
        self.assertEqual(view["status"], "error", view)
        self.assertTrue(view["message"])
        self.assertEqual(self.json("GET", "/api/info")[0], 200)       # the service survived

    def test_cancel_stops_the_export_and_removes_its_output(self):
        job = self.create()["id"]
        self.json("POST", "/api/jobs/%s/start" % job)
        self.json("POST", "/api/jobs/%s/cancel" % job)
        view = self.wait(job)
        self.assertEqual(view["status"], "cancelled", view)
        self.assertEqual(self.call("GET", "/api/jobs/%s/download" % job)[0], 409)


class StaticEditorTests(unittest.TestCase):
    """--static serves the built editor next to the API, so one container port is the whole app."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        (root / "dist" / "assets").mkdir(parents=True)
        (root / "dist" / "index.html").write_text("<title>editor</title>")
        (root / "dist" / "assets" / "app.js").write_text("console.log(1)")
        (root / "secret.txt").write_text("outside the editor folder")
        cls.httpd = server.make_server(0, static=root / "dist")
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.tmp.cleanup()

    def get(self, path, headers=None, host=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        hdrs = dict(headers or {})
        if host:
            hdrs["Host"] = host
        conn.request("GET", path, headers=hdrs)
        res = conn.getresponse()
        body = res.read()
        conn.close()
        return res.status, res, body

    def test_serves_the_editor_and_its_assets_without_the_api_header(self):
        status, res, body = self.get("/")
        self.assertEqual((status, body), (200, b"<title>editor</title>"))
        self.assertIn("text/html", res.getheader("Content-Type"))
        status, res, body = self.get("/assets/app.js")
        self.assertEqual(status, 200)
        self.assertIn("javascript", res.getheader("Content-Type"))
        self.assertEqual(self.get("/assets/missing.js")[0], 404)

    def test_cannot_read_outside_the_editor_folder(self):
        for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt", "/..%2fsecret.txt"):
            status, _, body = self.get(path)
            self.assertNotIn(b"outside the editor folder", body, path)
            self.assertIn(status, (200, 404), path)       # 200 only for index.html style fallbacks, never the secret

    def test_pages_still_need_a_localhost_host_and_the_api_still_needs_its_header(self):
        self.assertEqual(self.get("/", host="evil.example:8765")[0], 403)
        self.assertEqual(self.get("/api/info")[0], 403)
        self.assertEqual(self.get("/api/info", headers=H)[0], 200)


if __name__ == "__main__":
    unittest.main()
