#!/usr/bin/env python3
"""Render a booth demo video without DaVinci Resolve.

    python render/render.py my-recording.mp4 -t my-video.json -o my-video-final.mp4

Takes a finished edit (any video file), puts it in the content slot, and draws the chapter panel and timed
headlines from the same timings/*.json the Fusion script and the timing editor use.

    python render/render.py my-recording.mp4 -t my-video.json --frame 75 --png check.png    # one frame, no encode
    python render/render.py --selftest                                                      # quick end-to-end test

Needs only `pip install -r render/requirements.txt` (Pillow and a bundled static ffmpeg). A system ffmpeg is used
instead if the FFMPEG environment variable points at one, or if `ffmpeg` is on your PATH and --system-ffmpeg is given.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from PIL import Image  # noqa: E402

import layout as L  # noqa: E402
import layers  # noqa: E402
from timing import normalize_chapters  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------------------------- ffmpeg
def find_ffmpeg(prefer_system=False):
    if os.environ.get("FFMPEG"):
        return os.environ["FFMPEG"]
    if prefer_system and shutil.which("ffmpeg"):
        return shutil.which("ffmpeg")
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    if shutil.which("ffmpeg"):
        return shutil.which("ffmpeg")
    sys.exit("ffmpeg not found. Run: pip install -r render/requirements.txt  (or install ffmpeg and put it on PATH)")


def probe(ffmpeg, path):
    """(width, height, fps, duration_seconds, colour_tagged) read from `ffmpeg -i` output (the bundled build has
    no ffprobe). colour_tagged says whether the file declares its colour matrix (bt709, bt601, ...)."""
    r = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)], capture_output=True, text=True)
    err = r.stderr
    dur = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", err)
    video = next((ln for ln in err.splitlines() if "Video:" in ln), "")
    size = re.search(r"(\d{2,5})x(\d{2,5})", video.split("Video:")[1]) if video else None
    fps = re.search(r"(\d+(?:\.\d+)?)\s*fps", video)
    if not video:
        sys.exit("No video stream found in %s\n%s" % (path, err[-400:]))
    seconds = (int(dur.group(1)) * 3600 + int(dur.group(2)) * 60 + float(dur.group(3))) if dur else None
    tagged = bool(re.search(r"bt709|bt470|smpte|bt2020|bt601", video))
    return (int(size.group(1)), int(size.group(2)), float(fps.group(1)) if fps else 30.0, seconds, tagged)


def source_matrix(w, h, tagged):
    """Colour matrix to assume when decoding. Tagged files are decoded as tagged. Untagged HD files are
    treated as BT.709, which is what players do (ffmpeg alone would guess BT.601 and shift the colours)."""
    return "bt709" if (not tagged and h >= 720) else "auto"


# ---------------------------------------------------------------------------------------------- timing
def load_timing(arg):
    p = Path(arg)
    if not p.exists():
        p = ROOT / "timings" / (arg if arg.endswith(".json") else arg + ".json")
    if not p.exists():
        sys.exit("Timing file not found: %s (looked in timings/ too)" % arg)
    tm = json.loads(p.read_text())
    try:
        notice = normalize_chapters(tm)
    except ValueError as error:
        sys.exit("%s: %s" % (p, error))
    if notice:
        print("Timing import: " + notice, file=sys.stderr)
    return tm


# ---------------------------------------------------------------------------------------------- frames
def slot_filter(fps, matrix="auto"):
    """Decode chain: correct YUV->RGB first (so odd slot sizes like 1459 px are allowed), then fit into the slot."""
    cw, ch = L.CONTENT["w"], L.CONTENT["h"]
    return ("fps=%s,scale=in_color_matrix=%s:in_range=auto:out_range=full,format=rgb24,"
            "scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=black"
            % (fps, matrix, cw, ch, cw, ch))


def grab_frame(ffmpeg, video, t, fps, matrix="auto"):
    """One decoded frame at time t, already scaled to the content slot."""
    cw, ch = L.CONTENT["w"], L.CONTENT["h"]
    cmd = [ffmpeg, "-v", "error", "-ss", "%.3f" % max(0, t), "-i", str(video), "-frames:v", "1",
           "-vf", slot_filter(fps, matrix).split(",", 1)[1], "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    data = subprocess.run(cmd, capture_output=True).stdout
    if len(data) != cw * ch * 3:
        sys.exit("Could not read a frame at %.1fs (is that inside the video?)" % t)
    return Image.frombytes("RGB", (cw, ch), data)


def chapter_metadata(lay, start, dur):
    """ffmetadata text with one MP4 chapter per chapter switch, in output time (0 = first frame written)."""
    esc = lambda x: re.sub(r"([=;#\\\n])", r"\\\1", str(x))
    if lay.t.get("chapters_end") is not None:
        dur = min(dur, max(0.0, lay.t["chapters_end"] - start))
        if dur <= 0:
            return None
    marks = [(max(0.0, t - start), c) for t, c in lay.chapter_starts if t - start < dur]
    if not marks:
        return None
    if marks[0][0] > 0:                          # time before the first switch belongs to the first chapter's button
        marks.insert(0, (0.0, marks[0][1]))
    marks[0] = (0.0, marks[0][1])
    out = [";FFMETADATA1"]
    for i, (t, c) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else dur
        if end - t < 0.001:
            continue
        out += ["[CHAPTER]", "TIMEBASE=1/1000", "START=%d" % round(t * 1000), "END=%d" % round(end * 1000),
                "title=" + esc(lay.chapters[c - 1])]
    return "\n".join(out) + "\n"


def render_video(args, ffmpeg, lay):
    w, h, src_fps, src_dur, tagged = probe(ffmpeg, args.input)
    matrix = source_matrix(w, h, tagged)
    fps = args.fps or src_fps
    start = args.start or 0.0
    dur = args.duration if args.duration else (src_dur - start if src_dur else None)
    cw, ch = L.CONTENT["w"], L.CONTENT["h"]
    nbytes = cw * ch * 3
    total_frames = int(dur * fps) if dur else None
    print("Input %dx%d @ %.3g fps, %s (colour: %s)  ->  %dx%d @ %.3g fps" % (w, h, src_fps,
          ("%.1fs" % dur) if dur else "unknown length", matrix if matrix != "auto" else "as tagged",
          L.W, L.H, fps))

    meta = chapter_metadata(lay, start, dur) if dur else None
    meta_args = []
    if meta:
        meta_file = Path(tempfile.mkdtemp(prefix="booth-chapters-")) / "chapters.txt"
        meta_file.write_text(meta, encoding="utf-8")
        meta_args = ["-f", "ffmetadata", "-i", str(meta_file), "-map_chapters", "2"]

    dec_err, enc_err = tempfile.TemporaryFile(), tempfile.TemporaryFile()   # files, not pipes: can never fill up and block
    seek = ["-ss", "%.3f" % start] if start else []
    lim = ["-t", "%.3f" % dur] if args.duration else []
    dec = subprocess.Popen([ffmpeg, "-v", "error"] + seek + ["-i", str(args.input)] + lim +
                           ["-vf", slot_filter(fps, matrix), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                           stdout=subprocess.PIPE, stderr=dec_err)
    vcodec = ["-c:v", "libx264", "-crf", str(args.crf), "-preset", args.preset]
    if args.fast:
        vcodec = ["-c:v", "h264_videotoolbox", "-b:v", "12M"]
    enc = subprocess.Popen([ffmpeg, "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                            "-s", "%dx%d" % (L.W, L.H), "-r", str(fps), "-i", "-"] + seek + lim +
                           ["-i", str(args.input)] + meta_args + ["-map", "0:v", "-map", "1:a?"] + vcodec +
                           # RGB -> video colours with the HD matrix, and say so in the file, so players show the
                           # exact brand colours (ffmpeg's default would be BT.601 and shift SUSE green)
                           ["-vf", "scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p,"
                                   "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv",
                            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                            "-color_range", "tv",
                            "-c:a", "aac", "-b:a", "192k", "-shortest",
                            "-movflags", "+faststart", str(args.output)],
                           stdin=subprocess.PIPE, stderr=enc_err)
    t0 = time.time()
    i = 0
    try:
        while True:
            buf = dec.stdout.read(nbytes)
            while buf and len(buf) < nbytes:
                more = dec.stdout.read(nbytes - len(buf))
                if not more:
                    break
                buf += more
            if len(buf) < nbytes:
                break
            t = start + i / fps
            enc.stdin.write(lay.frame(t, Image.frombytes("RGB", (cw, ch), buf)).tobytes())
            i += 1
            if i % int(max(1, fps)) == 0:
                el = time.time() - t0
                msg = "\r%d frames  %.0f fps" % (i, i / el)
                if total_frames:
                    msg += "  %3d%%  ~%ds left" % (100 * i / total_frames, el * (total_frames - i) / i)
                print(msg + "   ", end="", flush=True)
    except BrokenPipeError:
        pass
    finally:
        try:
            enc.stdin.close()
        except Exception:
            pass
    enc.wait()
    # If the encoder stopped early, the decoder may be blocked writing into a pipe nobody reads any more.
    # Closing our end lets it exit; kill it if it still doesn't.
    try:
        dec.stdout.close()
    except Exception:
        pass
    try:
        dec.wait(timeout=10)
    except subprocess.TimeoutExpired:
        dec.kill()
        dec.wait()
    print()
    if enc.returncode != 0 or i == 0:
        def tail(f):
            f.seek(0)
            return f.read().decode(errors="replace")[-600:]
        sys.exit("Encoding failed.\nencoder: %s\ndecoder: %s" % (tail(enc_err), tail(dec_err)))
    print("Wrote %s  (%d frames, %.0fs)" % (args.output, i, time.time() - t0))


# ---------------------------------------------------------------------------------------------- self test
def selftest(args, ffmpeg):
    """Make a 6 second test clip, render it, check the result. No files needed."""
    tmp = Path(tempfile.mkdtemp(prefix="booth-selftest-"))
    clip, out, png = tmp / "in.mp4", tmp / "out.mp4", tmp / "frame.png"
    subprocess.run([ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=6",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-shortest", str(clip)], check=True)
    timing = tmp / "t.json"
    timing.write_text(json.dumps({
        "chapters": ["Intro", "Details", "Wrap up"], "product_name": "Self test",
        "chapter_starts": [[0, 1], [2, 2], [4, 3]],
        "headlines": [[0, "First *headline*"], [2, "Second one with *two words*"], [4, "Last *one*"]],
        "headlines_end": None, "wipe_seconds": 0.5}))
    ns = argparse.Namespace(input=str(clip), output=str(out), fps=None, start=None, duration=None,
                            crf=23, preset="veryfast", fast=False)
    lay = layers.Layout(load_timing(str(timing)))
    render_video(ns, ffmpeg, lay)
    _, _, fps, dur, _ = probe(ffmpeg, out)
    lay.frame(3.0, grab_frame(ffmpeg, clip, 3.0, 25, "bt709")).save(png)
    # brand colours must survive the trip into the MP4: decode a frame the way a player does (HD = BT.709)
    # and compare an inactive button's green with the brand value
    chk = tmp / "chk.png"
    subprocess.run([ffmpeg, "-y", "-v", "error", "-ss", "3", "-i", str(out), "-vf",
                    "scale=in_color_matrix=bt709:in_range=tv:out_range=full,format=rgb24", "-frames:v", "1", str(chk)],
                   check=True)
    got = Image.open(chk).convert("RGB").getpixel((45, 725))
    want = layers.rgb(L.BRAND["pill_base"])
    err = max(abs(g - e) for g, e in zip(got, want))
    colour_ok = err <= 6
    print("colour check: button green is %s in the MP4, brand value is %s (max error %d) -> %s"
          % (got, want, err, "ok" if colour_ok else "WRONG"))
    info = subprocess.run([ffmpeg, "-i", str(out)], capture_output=True, text=True).stderr
    titles = re.findall(r"Chapter #\S+: start ([\d.]+), end ([\d.]+)\s+Metadata:\s+title\s+: (.*)", info)
    chapters_ok = [t[2].strip() for t in titles] == ["Intro", "Details", "Wrap up"]
    print("chapter markers: %s -> %s" % ([t[2].strip() for t in titles], "ok" if chapters_ok else "WRONG"))
    ok = out.exists() and dur and abs(dur - 6) < 0.6 and colour_ok and chapters_ok
    print("selftest %s: %s (%.1fs, %.3g fps)\n  preview frame: %s" % ("OK" if ok else "FAILED", out, dur or 0, fps, png))
    return 0 if ok else 1


# ---------------------------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="Add the chapter panel and timed headlines to a video, no DaVinci needed.")
    ap.add_argument("input", nargs="?", help="finished video to put in the content slot")
    ap.add_argument("-t", "--timing", default="example.json", help="timings/<name>.json, or a path (default example.json)")
    ap.add_argument("-o", "--output", help="output .mp4 (default: <input>-branded.mp4)")
    ap.add_argument("--frame", type=float, metavar="SECONDS", help="render just this moment")
    ap.add_argument("--png", help="where to write the --frame image (default: frame.png)")
    ap.add_argument("--start", type=float, help="start this many seconds into the input")
    ap.add_argument("--duration", type=float, help="only render this many seconds")
    ap.add_argument("--fps", type=float, help="output frame rate (default: same as input)")
    ap.add_argument("--crf", type=int, default=18, help="x264 quality, lower is better (default 18)")
    ap.add_argument("--preset", default="medium", help="x264 speed preset (default medium)")
    ap.add_argument("--fast", action="store_true", help="use the Mac hardware encoder (h264_videotoolbox)")
    ap.add_argument("--system-ffmpeg", action="store_true", help="prefer ffmpeg from PATH over the bundled one")
    ap.add_argument("--selftest", action="store_true", help="render a generated test clip and exit")
    args = ap.parse_args()

    ffmpeg = find_ffmpeg(args.system_ffmpeg)
    if args.selftest:
        sys.exit(selftest(args, ffmpeg))
    lay = layers.Layout(load_timing(args.timing))

    if args.frame is not None:
        video = None
        if args.input:
            w, h, _, _, tagged = probe(ffmpeg, args.input)
            video = grab_frame(ffmpeg, args.input, args.frame, args.fps or 30, source_matrix(w, h, tagged))
        out = Path(args.png or "frame.png")
        lay.frame(args.frame, video).save(out)
        print("Wrote", out)
        return
    if not args.input:
        ap.error("give an input video (or use --selftest / --frame with --png)")
    if not Path(args.input).exists():
        sys.exit("Input not found: %s" % args.input)
    args.output = args.output or str(Path(args.input).with_suffix("")) + "-branded.mp4"
    render_video(args, ffmpeg, lay)


if __name__ == "__main__":
    main()
