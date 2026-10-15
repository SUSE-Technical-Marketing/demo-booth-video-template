#!/usr/bin/env python3
"""Local export service for the timing editor.

    python render/server.py            # listens on http://127.0.0.1:8766
    python render/server.py --static dist --port 8765     # also serves the built editor: one address for everything

The editor is a static web page, so it cannot run ffmpeg itself. Its Export dialog talks to this service instead
(through the dev server's /api proxy): it sends the project, uploads the linked videos, watches the progress and
downloads the finished MP4. The render itself is render.py's render_project, the same code the command line uses. Everything stays on this machine: the service only listens on 127.0.0.1, only takes
uploads (never file paths), refuses requests that lack the editor's header, and keeps its working files in a
temporary folder that is deleted when the job is removed or the service stops.
"""
import argparse
import json
import mimetypes
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import render  # noqa: E402
from project import project_resolution, validate_project  # noqa: E402

PORT = 8766
HEADER = "X-Booth-Export"
MAX_UPLOAD = 64 * 1024 ** 3
# quality -> (x264 crf, x264 preset); bitrates are for the hardware encoder, which has no crf
QUALITY = {"draft": (26, "veryfast"), "standard": (20, "medium"), "high": (16, "slow")}
BITRATE = ((2160, "40M"), (1440, "20M"), (1080, "12M"), (0, "6M"))


def safe_name(text, fallback="video"):
    name = re.sub(r"[^A-Za-z0-9._ -]+", "", str(text or "")).strip(" .-")
    return (name or fallback)[:80]


class Job:
    def __init__(self, options):
        self.id = uuid.uuid4().hex[:12]
        self.token = secrets.token_urlsafe(16)   # lets a plain browser download link fetch the finished video
        self.options = options
        self.dir = Path(tempfile.mkdtemp(prefix="booth-export-"))
        self.media = {}                 # slot -> uploaded path
        self.status = "created"         # created, uploading, preparing, rendering, done, error, cancelled
        self.message = ""
        self.fraction = 0.0
        self.fps = 0.0
        self.eta = None
        self.output = None
        self.cancel = threading.Event()
        self.started = None

    def view(self):
        return {"id": self.id, "status": self.status, "message": self.message, "progress": round(self.fraction, 4),
                "fps": round(self.fps, 1), "eta": None if self.eta is None else round(self.eta),
                "filename": self.options["filename"], "size": self.output.stat().st_size if self.output else None}

    def cleanup(self):
        shutil.rmtree(self.dir, ignore_errors=True)


class Service:
    def __init__(self, ffmpeg=None):
        self.ffmpeg = ffmpeg or render.find_ffmpeg()
        self.jobs = {}
        self.lock = threading.Lock()
        self._encoders = None

    def encoders(self):
        if self._encoders is None:
            out = subprocess.run([self.ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
            self._encoders = {"libx264": "libx264" in out, "h264_videotoolbox": "h264_videotoolbox" in out}
        return self._encoders

    def info(self):
        return {"ok": True, "ffmpeg": self.ffmpeg, "encoders": self.encoders(), "qualities": list(QUALITY)}

    # ---- jobs ----
    def create(self, body):
        project = body.get("project")
        if not isinstance(project, dict):
            raise ValueError("project must be the project file's JSON object")
        project = json.loads(json.dumps(project))
        try:                                         # validate now, so a bad project fails before any upload
            validate_project(project)
            size = body.get("size") or project["output"].get("resolution")
            width, height = project_resolution(size)
        except ValueError as error:
            raise ValueError("the project is not valid: %s" % error)
        quality = body.get("quality", "standard")
        if quality not in QUALITY:
            raise ValueError("quality must be one of: " + ", ".join(QUALITY))
        used = [m for m in project["media"] if any(c["media_id"] == m["id"] for c in project["clips"])]
        if not used:
            raise ValueError("add at least one video to export")
        # The job only ever sees its own file names (m0.mp4, ...), never a path from the editor.
        names = [m["path"].rsplit("/", 1)[-1] for m in used]      # slot n of the upload is used[n]
        for i, m in enumerate(used):
            m["path"] = "m%d%s" % (i, re.sub(r"[^A-Za-z0-9.]", "", Path(m["path"]).suffix)[:8])
        project["media"], project["media_folder"] = used, ""
        fast = bool(body.get("fast")) and self.encoders()["h264_videotoolbox"]
        title = (project["timing"].get("title") or "").strip()
        options = {"project": project, "size": "%dx%d" % (width, height), "height": height, "quality": quality,
                   "fast": fast, "names": names, "ids": [m["id"] for m in used],
                   "filename": safe_name(body.get("filename") or title or "booth-video") + ".mp4"}
        job = Job(options)
        with self.lock:
            self.jobs[job.id] = job
        return job

    def get(self, job_id):
        with self.lock:
            return self.jobs.get(job_id)

    def remove(self, job_id):
        with self.lock:
            job = self.jobs.pop(job_id, None)
        if job:
            job.cancel.set()
            job.cleanup()
        return job is not None

    def start(self, job):
        job.status, job.started = "preparing", time.time()
        threading.Thread(target=self._run, args=(job,), daemon=True).start()

    def _run(self, job):
        try:
            opts = job.options
            project_file = job.dir / "project.json"
            project_file.write_text(json.dumps(opts["project"]), encoding="utf-8")
            crf, preset = QUALITY[opts["quality"]]
            bitrate = next(rate for height, rate in BITRATE if opts["height"] >= height)
            args = SimpleNamespace(project=str(project_file), output=str(job.dir / "final.mp4"), frame=None, png=None,
                                   start=None, duration=None, crf=crf, preset=preset, fast=opts["fast"],
                                   bitrate=bitrate, size=opts["size"], fps=None)
            job.status = "rendering"

            def progress(fraction, note, fps=None, remaining=None):
                job.fraction, job.message = fraction, note
                if fps is not None:
                    job.fps, job.eta = fps, remaining
            done = render.render_project(args, self.ffmpeg, progress=progress, cancel=job.cancel)
            if not done:
                job.status = "cancelled"
                return
            job.output, job.fraction, job.eta, job.status, job.message = Path(args.output), 1.0, 0, "done", "Done"
        except BaseException as error:               # never let a failed render kill the service
            job.status, job.message = "error", str(error) or error.__class__.__name__
            if job.cancel.is_set():
                job.status = "cancelled"


class Handler(BaseHTTPRequestHandler):
    server_version = "BoothExport/1"
    service = None
    static = None                      # folder with the built editor (dist/), served for every path outside /api

    def log_message(self, fmt, *args):
        if self.server.verbose:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # ---- helpers ----
    def send_json(self, data, status=200):
        raw = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def fail(self, status, message):
        self.send_json({"error": message}, status)

    def local_host(self):
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
        if host not in ("127.0.0.1", "localhost", "::1"):         # DNS-rebinding guard
            self.fail(403, "this service only answers on localhost")
            return False
        return True

    def allowed(self):
        if not self.local_host():
            return False
        if self.download_token_ok():
            return True
        if self.headers.get(HEADER) != "1":                       # forces a CORS preflight, which we never grant
            self.fail(403, "missing %s header" % HEADER)
            return False
        return True

    def download_token_ok(self):
        """A GET /api/jobs/<id>/download?token=... link works without the header (a normal <a download> cannot send it)."""
        parts = self.route()
        if self.command != "GET" or len(parts) != 4 or parts[:2] != ["api", "jobs"] or parts[3] != "download":
            return False
        job = self.service.get(parts[2])
        given = parse_qs(urlparse(self.path).query).get("token", [""])[0]
        return bool(job) and secrets.compare_digest(given, job.token)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 16 * 1024 * 1024:
            raise ValueError("request too large")
        return json.loads(self.rfile.read(length) or b"{}")

    def route(self):
        return [p for p in urlparse(self.path).path.split("/") if p]

    # ---- verbs ----
    def serve_static(self):
        """The built editor: the same files GitHub Pages hosts. Never anything outside the folder."""
        root = self.static.resolve()
        name = unquote(urlparse(self.path).path).lstrip("/") or "index.html"
        target = (root / name).resolve()
        if root not in target.parents and target != root:
            return self.fail(404, "not found")
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            return self.fail(404, "not found")
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parts = self.route()
        if self.static and parts[:1] != ["api"]:                  # pages and assets need no header, only a local Host
            if self.local_host():
                self.serve_static()
            return
        if not self.allowed():
            return
        if parts == ["api", "info"]:
            return self.send_json(self.service.info())
        if len(parts) >= 3 and parts[:2] == ["api", "jobs"]:
            job = self.service.get(parts[2])
            if not job:
                return self.fail(404, "no such export")
            if len(parts) == 3:
                return self.send_json(job.view())
            if parts[3] == "download":
                if job.status != "done" or not job.output or not job.output.exists():
                    return self.fail(409, "the video is not ready")
                size = job.output.stat().st_size
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(size))
                self.send_header("Content-Disposition", 'attachment; filename="%s"' % job.options["filename"])
                self.end_headers()
                with open(job.output, "rb") as f:
                    shutil.copyfileobj(f, self.wfile, 1024 * 1024)
                return
        self.fail(404, "not found")

    def do_POST(self):
        if not self.allowed():
            return
        parts = self.route()
        try:
            if parts == ["api", "jobs"]:
                job = self.service.create(self.read_json())
                return self.send_json({"id": job.id, "token": job.token, "media": job.options["ids"],
                                       "names": job.options["names"],
                                       "filename": job.options["filename"]}, 201)
            if len(parts) == 4 and parts[:2] == ["api", "jobs"]:
                job = self.service.get(parts[2])
                if not job:
                    return self.fail(404, "no such export")
                if parts[3] == "start":
                    missing = [n for i, n in enumerate(job.options["names"]) if i not in job.media]
                    if missing:
                        return self.fail(409, "videos not uploaded yet: %s" % ", ".join(missing))
                    self.service.start(job)
                    return self.send_json(job.view())
                if parts[3] == "cancel":
                    job.cancel.set()
                    if job.status not in ("done", "error"):
                        job.status = "cancelled"
                    return self.send_json(job.view())
        except (ValueError, json.JSONDecodeError) as error:
            return self.fail(400, str(error))
        self.fail(404, "not found")

    def do_PUT(self):
        if not self.allowed():
            return
        parts = self.route()
        if len(parts) == 5 and parts[:2] == ["api", "jobs"] and parts[3] == "media" and parts[4].isdigit():
            job, slot = self.service.get(parts[2]), int(parts[4])
            if not job:
                return self.fail(404, "no such export")
            if slot >= len(job.options["names"]):
                return self.fail(400, "there is no video number %d in this export" % slot)
            length = int(self.headers.get("Content-Length") or -1)
            if length < 0 or length > MAX_UPLOAD:
                return self.fail(413, "the upload needs a Content-Length of at most %d bytes" % MAX_UPLOAD)
            path = job.dir / job.options["project"]["media"][slot]["path"]
            job.status = "uploading"
            remaining = length
            with open(path, "wb") as f:
                while remaining:
                    chunk = self.rfile.read(min(remaining, 1024 * 1024))
                    if not chunk:
                        return self.fail(400, "the upload ended early")
                    f.write(chunk)
                    remaining -= len(chunk)
            job.media[slot] = path
            return self.send_json({"ok": True, "media": slot, "bytes": length})
        self.fail(404, "not found")

    def do_DELETE(self):
        if not self.allowed():
            return
        parts = self.route()
        if len(parts) == 3 and parts[:2] == ["api", "jobs"]:
            return self.send_json({"removed": self.service.remove(parts[2])})
        self.fail(404, "not found")


def make_server(port=PORT, ffmpeg=None, verbose=False, host="127.0.0.1", static=None):
    service = Service(ffmpeg)
    handler = type("BoundHandler", (Handler,), {"service": service, "static": Path(static) if static else None})
    httpd = ThreadingHTTPServer((host, port), handler)
    httpd.service, httpd.verbose = service, verbose
    return httpd


def main():
    ap = argparse.ArgumentParser(description="Local export service for the timing editor.")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--host", default="127.0.0.1", help="address to listen on. Only change it inside a container, "
                    "and publish the port to 127.0.0.1 only (run-container.sh --ui does this)")
    ap.add_argument("--static", metavar="DIR", help="also serve the built editor (dist/) from this folder")
    ap.add_argument("--public-port", type=int, help="port to show in the startup message when it is published "
                    "under a different number (inside a container)")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    try:
        httpd = make_server(args.port, verbose=args.verbose, host=args.host, static=args.static)
    except OSError as error:
        sys.exit("Could not listen on %s:%d (%s). Is the export service already running?" % (args.host, args.port, error))
    print("%s: http://127.0.0.1:%d  (ffmpeg: %s)" % ("Editor and export service" if args.static else "Export service",
                                                      args.public_port or args.port, httpd.service.ffmpeg), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for job_id in list(httpd.service.jobs):
            httpd.service.remove(job_id)


if __name__ == "__main__":
    main()
