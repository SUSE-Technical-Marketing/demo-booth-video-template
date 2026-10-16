"""Portable project validation and frame-aligned timeline planning."""

import copy
import json
import math
import re
from fractions import Fraction
from pathlib import Path

from timing import normalize_chapters
from layout import theme_layout


def _time(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def _id(value):
    return isinstance(value, str) and bool(value.strip())


DEFAULT_FPS = "25/1"


def _relative_path(value):
    return _id(value) and not re.match(r"[/\\]|[a-z][a-z\d+.-]*:", value, re.I) and not any(
        char in value for char in "\\\0\r\n")


def normalize_media_folder(folder=""):
    if folder == "" or _relative_path(folder):
        normalized = "/".join(part for part in folder.split("/") if part and part != ".")
        if not normalized or _relative_path(normalized):
            return normalized
    raise ValueError("Media folder must be a relative path using forward slashes, or empty for the project folder")


def resolve_media_path(path, folder=""):
    prefix = normalize_media_folder(folder)
    if not _relative_path(path):
        raise ValueError("Media path must be a relative path using forward slashes")
    return "%s/%s" % (prefix, path) if prefix else path


def project_fps(value):
    if not isinstance(value, str) or not re.fullmatch(r"[1-9]\d*/[1-9]\d*", value):
        raise ValueError("Output FPS must be a fraction such as 25/1")
    fps = Fraction(value)
    if not 1 <= fps <= 120 or any(int(part) > 9007199254740991 for part in value.split("/")):
        raise ValueError("Output FPS must be between 1 and 120")
    return fps


DEFAULT_RESOLUTION = (1920, 1080)
MAX_RESOLUTION = (7680, 4320)


def project_resolution(value):
    """Output frame size as (width, height). None keeps the 1920x1080 design size."""
    if value is None:
        return DEFAULT_RESOLUTION
    if not isinstance(value, str) or not re.fullmatch(r"[1-9]\d*x[1-9]\d*", value):
        raise ValueError("Output resolution must be WIDTHxHEIGHT such as 1280x720")
    width, height = (int(part) for part in value.split("x"))
    if width % 2 or height % 2 or not 16 <= width <= MAX_RESOLUTION[0] or not 16 <= height <= MAX_RESOLUTION[1]:
        raise ValueError("Output resolution must use even sizes between 16x16 and %dx%d" % MAX_RESOLUTION)
    return width, height


def validate_project(project):
    if not isinstance(project, dict) or type(project.get("project_version")) is not int or project["project_version"] != 1:
        raise ValueError("Expected a version 1 project JSON")
    if not isinstance(project.get("output"), dict):
        raise ValueError("Project needs output FPS")
    fps = float(project_fps(project["output"].get("fps", DEFAULT_FPS)))
    theme_layout(project["output"].get("theme", "classic"))
    project_resolution(project["output"].get("resolution"))
    normalize_media_folder(project.get("media_folder", ""))
    media, clips = project.get("media"), project.get("clips")
    if not isinstance(media, list) or not isinstance(clips, list):
        raise ValueError("Project needs media and clips arrays")
    ids = set()
    for item in media:
        if not isinstance(item, dict) or not _id(item.get("id")) or item["id"] in ids:
            raise ValueError("Media needs unique IDs")
        if not _relative_path(item.get("path")):
            raise ValueError("Media paths must be relative paths using forward slashes")
        ids.add(item["id"])
    clip_ids = set()
    for clip in clips:
        if not isinstance(clip, dict) or not _id(clip.get("id")) or clip["id"] in clip_ids or not _id(
                clip.get("media_id")) or clip["media_id"] not in ids:
            raise ValueError("Clips need unique IDs and existing media")
        if any(not _time(clip.get(key)) for key in ("start", "source_in", "source_out")) or clip["source_out"] <= clip["source_in"]:
            raise ValueError("Clips need non-negative times and source out after source in")
        if clip.get("freeze") is not None and not isinstance(clip["freeze"], bool):
            raise ValueError("freeze must be true or false")
        clip_ids.add(clip["id"])
    end = 0
    previous = None
    for clip in sorted(clips, key=lambda c: c["start"]):
        transition = clip.get("transition_in")
        if transition is not None:
            if (not isinstance(transition, dict) or transition.get("type") != "crossfade"
                    or not _time(transition.get("duration")) or transition["duration"] < 1 / fps - 1e-6):
                raise ValueError("A cross-dissolve needs a duration of at least one output frame")
            length = transition["duration"]
            if previous is None or abs(end - clip["start"] - length) > 1e-6:
                raise ValueError("A dissolve must exactly match the overlap with the preceding clip")
            if (length >= clip["source_out"] - clip["source_in"] - 1e-6
                    or (previous.get("transition_in") or {}).get("duration", 0) + length
                    > previous["source_out"] - previous["source_in"] - 1e-6):
                raise ValueError("Dissolves must leave room in both clips and cannot overlap another dissolve")
        elif clip["start"] < end - 1e-6:
            raise ValueError("Clips overlap; add a cross-dissolve or move or trim them to use hard cuts")
        end = clip["start"] + clip["source_out"] - clip["source_in"]
        if not math.isfinite(end) or end * fps > 9007199254740991:
            raise ValueError("Clip timeline is too large")
        if math.ceil(end * fps - 1e-7) <= math.ceil(clip["start"] * fps - 1e-7):
            raise ValueError("Clip has no frames at the output frame rate")
        previous = clip
    timing = project.get("timing")
    if not isinstance(timing, dict) or timing.get("schema_version") != 2:
        raise ValueError("Project timing must use schema version 2")
    for key in ("title", "product_name"):
        if timing.get(key) is not None and not isinstance(timing[key], str):
            raise ValueError("%s must be text" % key)
    normalize_chapters(copy.deepcopy(timing))
    return project


def load_project(path):
    path = Path(path).resolve()
    return validate_project(json.loads(path.read_text(encoding="utf-8"))), path


def timeline_segments(project):
    """Partition at frame-aligned boundaries, retaining both sources during a dissolve."""
    fps = float(project_fps(project["output"].get("fps", DEFAULT_FPS)))
    frame = lambda time: math.ceil(time * fps - 1e-7)
    clips = sorted(project["clips"], key=lambda c: c["start"])
    bounds = sorted({0} | {frame(t) for c in clips for t in (c["start"], c["start"] + c["source_out"] - c["source_in"])})
    segments = []
    for first, last in zip(bounds, bounds[1:]):
        active = [c for c in clips if frame(c["start"]) <= first < frame(c["start"] + c["source_out"] - c["source_in"])]
        segment = {"clip": active[0] if active else None, "frames": last - first}
        for i, clip in enumerate(active):
            key = "source_start" if i == 0 else "incoming_source_start"
            segment[key] = clip["source_in"] if clip.get("freeze") else clip["source_in"] + first / fps - clip["start"]
        if len(active) == 2:
            incoming = active[1]
            segment.update(incoming=incoming, mix_start=(first / fps - incoming["start"]) / incoming["transition_in"]["duration"])
        segments.append(segment)
    return segments
