"""Assemble a normalized, lossless content track for the branding renderer."""

import subprocess
from pathlib import Path

import layout as L
from project import DEFAULT_FPS, project_fps, resolve_media_path, timeline_segments


def _run(command):
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise ValueError("Media assembly failed:\n" + result.stderr[-3000:])


def assemble_project(project, project_path, directory, ffmpeg, probe, slot_filter, source_matrix, progress=None, cancel=None):
    """Join the clips into one master track. Returns (path, seconds), or None if cancel (a threading.Event) was set."""
    directory = Path(directory)
    content = L.theme_layout(project["output"].get("theme", "classic")).CONTENT
    fps = project["output"].get("fps", DEFAULT_FPS)
    rate = float(project_fps(fps))
    sources = {m["id"]: (Path(project_path).parent / resolve_media_path(m["path"], project.get("media_folder", ""))).resolve()
               for m in project["media"]}
    info = {}
    for clip in project["clips"]:
        path = sources[clip["media_id"]]
        if not path.is_file():
            raise ValueError("Missing media for %s: %s" % (clip["id"], path))
        if path not in info:
            w, h, src_fps, duration, tagged = probe(ffmpeg, path)
            inspected = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)], capture_output=True, text=True)
            info[path] = (w, h, src_fps, duration, tagged, "Audio:" in inspected.stderr)
        slack = max(0.01, 1 / info[path][2])
        # a freeze clip only needs its one frame to exist: its source_out is just source_in plus the hold length
        reach = clip["source_in"] if clip.get("freeze") else clip["source_out"]
        if info[path][3] is None or reach > info[path][3] + slack:
            raise ValueError("%s for %s: %s" % ("Freeze frame is past the end of the media" if clip.get("freeze")
                                               else "Source out exceeds media duration", clip["id"], path))
    segments = timeline_segments(project)
    if not segments:
        raise ValueError("Project has no clips to render; add media in Videos")
    files = []
    for index, segment in enumerate(segments):
        if cancel is not None and cancel.is_set():
            return None
        if progress:
            progress(index / len(segments))
        output = directory / ("%06d.mkv" % index)
        frames = segment["frames"]
        duration = frames / rate
        command = [ffmpeg, "-y", "-v", "error"]
        tracks = [segment["clip"]] + ([segment["incoming"]] if "incoming" in segment else [])
        filters = []
        silence_input = len(tracks)
        for track, clip in enumerate(tracks):
            if clip:
                path = sources[clip["media_id"]]
                w, h, _, _, tagged, audio = info[path]
                source_start = segment["source_start" if track == 0 else "incoming_source_start"]
                if clip.get("freeze"):
                    command += ["-ss", "%.9f" % source_start, "-i", str(path)]
                    video = (slot_filter(fps, source_matrix(w, h, tagged), content) +
                             ",trim=end_frame=1,tpad=stop_mode=clone:stop_duration=%.9f" % duration +
                             ",trim=end_frame=%d,setpts=PTS-STARTPTS" % frames)
                    audio = False
                else:
                    command += ["-ss", "%.9f" % source_start, "-t", "%.9f" % (clip["source_out"] - source_start),
                                "-i", str(path)]
                    video = ("tpad=stop_mode=clone:stop_duration=%.9f," % duration +
                             slot_filter(fps, source_matrix(w, h, tagged), content) +
                             ",trim=end_frame=%d,setpts=PTS-STARTPTS" % frames)
            else:
                command += ["-f", "lavfi", "-i", "color=c=black:s=1920x1080:r=" + fps]
                video = "scale=%d:%d,format=rgb24,trim=end_frame=%d,setpts=PTS-STARTPTS" % (
                    content["w"], content["h"], frames)
                audio = False
            audio_input = "%d:a:0" % (track if audio else silence_input)
            filters.append("[%d:v:0]%s,format=gbrp[v%d]" % (track, video, track))
            filters.append("[%s]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=%.9f,asetpts=PTS-STARTPTS[a%d]" % (
                audio_input, duration, track))
        command += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        if len(tracks) == 2:
            length = segment["incoming"]["transition_in"]["duration"]
            phase = "min(1,max(0,%.12f+T/%.12f))" % (segment["mix_start"], length)
            filters.append("[v0][v1]blend=all_expr='A*(1-(%s))+B*(%s)'[v]" % (phase, phase))
            for track in range(2):
                gain = phase.lower() if track else "1-(%s)" % phase.lower()
                filters.append("[a%d]aeval=exprs='val(0)*(%s)|val(1)*(%s)'[mix%d]" % (track, gain, gain, track))
            filters.append("[mix0][mix1]amix=inputs=2:normalize=0[a]")
        else:
            filters += ["[v0]null[v]", "[a0]anull[a]"]
        command += ["-filter_complex", ";".join(filters), "-map", "[v]", "-map", "[a]",
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
