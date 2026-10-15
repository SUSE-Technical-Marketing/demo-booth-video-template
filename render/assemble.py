"""Assemble a normalized, lossless content track for the branding renderer."""

import subprocess
from pathlib import Path

import layout as L
from project import project_fps, timeline_segments


def _run(command):
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise ValueError("Media assembly failed:\n" + result.stderr[-3000:])


def assemble_project(project, project_path, directory, ffmpeg, probe, slot_filter, source_matrix):
    directory = Path(directory)
    fps = project["output"]["fps"]
    rate = float(project_fps(fps))
    sources = {m["id"]: (Path(project_path).parent / m["path"]).resolve() for m in project["media"]}
    info = {}
    for clip in project["clips"]:
        path = sources[clip["media_id"]]
        if not path.is_file():
            raise ValueError("Missing media for %s: %s" % (clip["id"], path))
        if path not in info:
            w, h, src_fps, duration, tagged = probe(ffmpeg, path)
            inspected = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)], capture_output=True, text=True)
            info[path] = (w, h, src_fps, duration, tagged, "Audio:" in inspected.stderr)
        if info[path][3] is None or clip["source_out"] > info[path][3] + max(0.01, 1 / info[path][2]):
            raise ValueError("Source out exceeds media duration for %s: %s" % (clip["id"], path))
    segments = timeline_segments(project)
    if not segments:
        raise ValueError("Project has no clips to render; add media in Videos & settings")
    files = []
    for index, segment in enumerate(segments):
        output = directory / ("%06d.mkv" % index)
        frames = segment["frames"]
        duration = frames / rate
        clip = segment["clip"]
        command = [ffmpeg, "-y", "-v", "error"]
        if clip:
            path = sources[clip["media_id"]]
            w, h, _, _, tagged, audio = info[path]
            source_start = segment["source_start"]
            command += ["-ss", "%.9f" % source_start, "-t", "%.9f" % (clip["source_out"] - source_start),
                        "-i", str(path)]
            video = ("tpad=stop_mode=clone:stop_duration=%.9f," % duration +
                     slot_filter(fps, source_matrix(w, h, tagged)) +
                     ",trim=end_frame=%d,setpts=PTS-STARTPTS" % frames)
        else:
            command += ["-f", "lavfi", "-i", "color=c=black:s=1920x1080:r=" + fps]
            video = "scale=%d:%d,format=rgb24,trim=end_frame=%d,setpts=PTS-STARTPTS" % (
                L.CONTENT["w"], L.CONTENT["h"], frames)
            audio = False
        command += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        audio_input = "0:a:0" if audio else "1:a:0"
        filters = "[0:v:0]%s[v];[%s]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=%.9f,asetpts=PTS-STARTPTS[a]" % (
            video, audio_input, duration)
        command += ["-filter_complex", filters, "-map", "[v]", "-map", "[a]",
                    "-t", "%.9f" % duration, "-r", fps, "-c:v", "ffv1", "-level", "3", "-pix_fmt", "bgr0",
                    "-c:a", "pcm_s16le", str(output)]
        _run(command)
        files.append((output, duration))
    listing = directory / "segments.ffconcat"
    listing.write_text("ffconcat version 1.0\n" + "".join(
        "file '%s'\nduration %.9f\n" % (path.name, duration) for path, duration in files), encoding="utf-8")
    master = directory / "assembled.mkv"
    _run([ffmpeg, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
          "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", str(master)])
    return master, sum(segment["frames"] for segment in segments) / rate
