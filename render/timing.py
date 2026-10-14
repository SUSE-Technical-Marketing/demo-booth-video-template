"""Shared timing validation, legacy migration and chapter-bounded headline windows."""

import math


def _time(value, relative=False):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and (
        relative or value >= 0)


def _headlines(rows, relative=False):
    return isinstance(rows, list) and all(
        isinstance(row, (list, tuple)) and len(row) == 2 and _time(row[0], relative) and
        isinstance(row[1], str) and row[1].strip() for row in rows)


def normalize_chapters(timing):
    """Normalize either JSON schema to renderer arrays, without rewriting the source file."""
    if not isinstance(timing, dict):
        raise ValueError("Timing must be a JSON object")
    version = timing.get("schema_version", 1)
    if isinstance(version, bool) or version not in (1, 2):
        raise ValueError("Unsupported timing schema version")
    chapters = timing.get("chapters")
    if not isinstance(chapters, list) or not chapters:
        raise ValueError('"chapters" is missing or empty')
    end = timing.get("headlines_end")
    if end is not None and not _time(end):
        raise ValueError("headlines_end must be a non-negative time or null")
    wipe = timing.get("wipe_seconds")
    if wipe is None:
        wipe = 0.8
    if not _time(wipe):
        raise ValueError("wipe_seconds must be non-negative")
    notices = []
    if version == 2:
        if any(not isinstance(c, dict) or not isinstance(c.get("title"), str) or not _time(c.get("start")) or
               not _headlines(c.get("headlines"), relative=True) for c in chapters):
            raise ValueError("Each chapter needs a title, non-negative start and valid relative headline list")
        owned = sorted(chapters, key=lambda c: c["start"])
    else:
        if any(not isinstance(c, str) for c in chapters):
            raise ValueError("chapters must contain chapter titles")
        starts = timing.get("chapter_starts")
        if not isinstance(starts, list) or not starts or any(
                not isinstance(row, (list, tuple)) or len(row) != 2 or not _time(row[0]) or
                not _time(row[1]) or int(row[1]) != row[1]
                for row in starts):
            raise ValueError("chapter_starts must contain valid times and chapter numbers")
        for sec, ch in starts:
            if not 1 <= ch <= len(chapters):
                raise ValueError("chapter switch at %ss points to chapter %s, but only 1-%d exist" %
                                 (sec, ch, len(chapters)))
        if not _headlines(timing.get("headlines")):
            raise ValueError("headlines must contain valid times and non-empty text")
        starts = sorted(((sec, int(ch)) for sec, ch in starts), key=lambda row: row[0])
        used = {ch for _, ch in starts}
        if len(used) < len(starts):
            notices.append("Converted repeated chapter switches into independent chapters.")
        if len(used) < len(chapters):
            notices.append("Ignored unused chapter titles with no start time.")
        owned = [{"start": sec, "title": chapters[ch - 1], "headlines": []} for sec, ch in starts]
        for sec, text in timing["headlines"]:
            chapter = next((c for c in reversed(owned) if c["start"] <= sec), owned[0])
            chapter["headlines"].append([sec - chapter["start"], text])
        notices.append("Assigned headlines to their chapters using chapter-relative times.")

    intervals = []
    outside = 0
    for i, chapter in enumerate(owned):
        boundary = min(owned[i + 1]["start"] if i + 1 < len(owned) else math.inf,
                       end if end is not None else math.inf)
        rows = sorted(chapter["headlines"], key=lambda row: row[0])
        for j, (relative, text) in enumerate(rows):
            start = chapter["start"] + relative
            if relative < 0 or start >= boundary:
                outside += 1
                continue
            stop = min(chapter["start"] + rows[j + 1][0] if j + 1 < len(rows) else math.inf, boundary)
            intervals.append((float(start), text, None if math.isinf(stop) else float(stop)))
    if outside:
        notices.append("Skipped %d headline(s) outside their chapter or headline end." % outside)
    timing["schema_version"] = 1  # Internal renderer arrays, not the file's persisted schema.
    timing["chapters"] = [c["title"] for c in owned]
    timing["chapter_starts"] = [[float(c["start"]), i + 1] for i, c in enumerate(owned)]
    timing["headlines"] = sorted(
        [[c["start"] + sec, text] for c in owned for sec, text in c["headlines"]], key=lambda row: row[0])
    timing["wipe_seconds"] = wipe
    timing["_headline_intervals"] = intervals
    return " ".join(notices)


def headline_intervals(timing):
    """Return absolute (start, text, end) windows; None means the final clip boundary."""
    if "_headline_intervals" not in timing:
        timing = dict(timing)
        normalize_chapters(timing)
    return timing["_headline_intervals"]
