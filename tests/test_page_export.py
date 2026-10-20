"""The interactive page export: a zip with index.html (the player filled in with the timing) and the footage."""
import copy
import http.client
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zipfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "render"))
import server
from render import find_ffmpeg, probe

H = {"X-Booth-Export": "1"}
TEMPLATE = ('<!doctype html><title>__BOOTH_TITLE__</title><script type="application/json" id="booth-data">'
            '__BOOTH_DATA__</script><p>player</p>')
PROJECT = {
    "project_version": 1, "output": {"fps": "25/1", "resolution": "1920x1080", "theme": "dark-rail"},
    "media_folder": "recordings", "media": [{"id": "ma", "path": "takes/a.mp4"}],
    "clips": [{"id": "ca", "media_id": "ma", "start": 0, "source_in": 0, "source_out": 2}],
    "timing": {"schema_version": 2, "title": "Booth </script><b>demo</b> & co", "product_name": "Self test",
               "chapters": [{"title": "Intro", "start": 0, "headlines": [[0, "First *headline*"]]},
                            {"title": "Install", "start": 1, "level": 1, "headlines": [[0, "Second"]]}]},
}


class PageExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ffmpeg = find_ffmpeg()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.template = Path(cls.tmp.name) / "player.html"
        cls.template.write_text(TEMPLATE, encoding="utf-8")
        cls.httpd = server.make_server(0, player=cls.template)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.clip = Path(cls.tmp.name) / "a.mp4"
        subprocess.run([cls.ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=2",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "aac", "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", str(cls.clip)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        for job_id in list(cls.httpd.service.jobs):
            cls.httpd.service.remove(job_id)
        cls.tmp.cleanup()

    def call(self, method, path, body=None, raw=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=120)
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        conn.request(method, path, body=data, headers=H)
        res = conn.getresponse()
        payload = res.read()
        conn.close()
        return res.status, res, payload

    def json(self, *args, **kwargs):
        status, _, payload = self.call(*args, **kwargs)
        return status, json.loads(payload)

    def export(self, project=PROJECT, **extra):
        status, job = self.json("POST", "/api/jobs", {"project": project, "kind": "page", "quality": "draft", **extra})
        self.assertEqual(status, 201, job)
        self.assertEqual(self.json("PUT", "/api/jobs/%s/media/0" % job["id"], raw=self.clip.read_bytes())[0], 200)
        self.assertEqual(self.json("POST", "/api/jobs/%s/start" % job["id"])[0], 200)
        end = time.time() + 120
        while time.time() < end:
            view = self.json("GET", "/api/jobs/" + job["id"])[1]
            if view["status"] in ("done", "error", "cancelled"):
                return job, view
            time.sleep(0.2)
        self.fail("export did not finish")

    def test_the_service_says_whether_it_can_make_pages(self):
        self.assertTrue(self.json("GET", "/api/info")[1]["page"])
        other = server.Service(player=Path(self.tmp.name) / "missing.html")
        self.assertFalse(other.info()["page"])

    def test_packs_the_player_the_timing_and_the_footage_in_a_zip(self):
        job, view = self.export()
        self.assertEqual(view["status"], "done", view)
        self.assertEqual(job["filename"], "Booth scriptbdemob  co.zip")
        status, res, payload = self.call("GET", "/api/jobs/%s/download?token=%s" % (job["id"], job["token"]))
        self.assertEqual((status, res.getheader("Content-Type")), (200, "application/zip"))
        archive = zipfile.ZipFile(io.BytesIO(payload))
        folder = "Booth scriptbdemob  co/"
        self.assertEqual(sorted(archive.namelist()), [folder + "README.txt", folder + "index.html", folder + "video.mp4"])
        index = archive.read(folder + "index.html").decode()
        data = json.loads(re.search(r'id="booth-data">(.*?)</script>', index, re.S).group(1))
        self.assertEqual(data["video"], "video.mp4")
        self.assertEqual(data["output"], {"theme": "dark-rail"})
        self.assertEqual([c["title"] for c in data["timing"]["chapters"]], ["Intro", "Install"])
        self.assertEqual(data["timing"]["chapters"][1]["level"], 1)
        self.assertNotIn("clips", data)
        self.assertNotIn("media", data)
        self.assertNotIn("takes/a.mp4", index)

    def test_a_title_cannot_break_out_of_the_page(self):
        job, view = self.export()
        payload = self.call("GET", "/api/jobs/%s/download?token=%s" % (job["id"], job["token"]))[2]
        index = zipfile.ZipFile(io.BytesIO(payload)).read("Booth scriptbdemob  co/index.html").decode()
        self.assertEqual(index.count("</script>"), 1)                    # only the page's own closing tag
        self.assertIn("<title>Booth &lt;/script&gt;&lt;b&gt;demo&lt;/b&gt; &amp; co</title>", index)
        self.assertNotIn("<b>demo</b>", index)

    def test_the_footage_is_a_plain_mp4_of_the_whole_timeline(self):
        job, view = self.export()
        payload = self.call("GET", "/api/jobs/%s/download?token=%s" % (job["id"], job["token"]))[2]
        folder = Path(self.tmp.name) / "unzipped"
        zipfile.ZipFile(io.BytesIO(payload)).extractall(folder)
        width, height, fps, duration, _ = probe(self.ffmpeg, folder / "Booth scriptbdemob  co" / "video.mp4")
        self.assertEqual((width, height), (1504, 846))                  # the Dark rail video area
        self.assertAlmostEqual(duration, 2.0, delta=0.1)
        self.assertAlmostEqual(fps, 25, delta=0.1)

    def test_can_be_cancelled(self):
        status, job = self.json("POST", "/api/jobs", {"project": PROJECT, "kind": "page"})
        self.assertEqual(status, 201)
        self.json("PUT", "/api/jobs/%s/media/0" % job["id"], raw=self.clip.read_bytes())
        self.json("POST", "/api/jobs/%s/cancel" % job["id"])
        self.assertEqual(self.json("GET", "/api/jobs/" + job["id"])[1]["status"], "cancelled")

    def test_refuses_when_the_page_is_not_built_or_the_kind_is_unknown(self):
        status, data = self.json("POST", "/api/jobs", {"project": PROJECT, "kind": "gif"})
        self.assertEqual(status, 400)
        self.assertIn("kind", data["error"])
        service = server.Service(player=Path(self.tmp.name) / "missing.html")
        with self.assertRaises(ValueError) as caught:
            service.create({"project": copy.deepcopy(PROJECT), "kind": "page"})
        self.assertIn("bun run build:player", str(caught.exception))

    def test_a_template_that_is_out_of_date_is_reported(self):
        old = Path(self.tmp.name) / "old.html"
        old.write_text("<p>no placeholders</p>")
        service = server.Service(player=old)
        job = service.create({"project": copy.deepcopy(PROJECT), "kind": "page"})
        with self.assertRaises(ValueError) as caught:
            service.package_page(job, self.clip)
        self.assertIn("out of date", str(caught.exception))
        service.remove(job.id)

    def test_video_exports_are_unchanged(self):
        status, job = self.json("POST", "/api/jobs", {"project": PROJECT, "quality": "draft"})
        self.assertEqual((status, job["filename"]), (201, "Booth scriptbdemob  co.mp4"))


if __name__ == "__main__":
    unittest.main()
