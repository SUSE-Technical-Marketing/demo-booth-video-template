"""Normalize legacy chapter references into independent, forward-only chapters."""


def normalize_chapters(timing):
    starts = sorted(timing["chapter_starts"], key=lambda row: float(row[0]))
    used = {int(ch) for _, ch in starts}
    notices = []
    if len(used) < len(starts):
        notices.append("Converted repeated chapter switches into independent chapters.")
    if len(used) < len(timing["chapters"]):
        notices.append("Ignored unused chapter titles with no start time.")
    timing["chapters"] = [timing["chapters"][int(ch) - 1] for _, ch in starts]
    timing["chapter_starts"] = [[float(sec), i + 1] for i, (sec, _) in enumerate(starts)]
    return " ".join(notices)
