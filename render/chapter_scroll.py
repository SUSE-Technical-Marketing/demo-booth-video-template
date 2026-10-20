"""Timeline-driven chapter scrolling for the renderer (the editor preview mirrors it in timing.js).

Chapters may have sub-chapters (level 1). A theme that supports them lists every top-level chapter plus the
sub-chapters of the chapter that is playing, so the list can change length when the playing chapter changes.
"""


def parents(levels):
    """1-based number of each chapter's top-level chapter (a top-level chapter is its own)."""
    out, top = [], 1
    for i, level in enumerate(levels, 1):
        if not level:
            top = i
        out.append(top)
    return out


def visible_rows(levels, active):
    """1-based chapter numbers listed while chapter `active` plays."""
    top = parents(levels)
    return [i for i in range(1, len(levels) + 1) if not levels[i - 1] or top[i - 1] == top[active - 1]]


def labels(levels):
    """Row labels: 01, 02 for chapters and 2.1, 2.2 for their sub-chapters."""
    out, number, sub = [], 0, 0
    for level in levels:
        if level:
            sub += 1
            out.append("%d.%d" % (number, sub))
        else:
            number, sub = number + 1, 0
            out.append("%02d" % number)
    return out


def window_start(active, count, visible, previous):
    return max(0, min(count - visible, active - previous - 1))


def scroll_position(t, steps, seconds):
    start, origin, target = steps[0]
    for step in steps:
        if step[0] > t:
            break
        start, origin, target = step
    p = max(0.0, min(1.0, (t - start) / seconds))
    return origin + (target - origin) * p * p * (3 - 2 * p)


def scroll_steps(chapter_starts, count, settings, levels=None):
    """(start, origin, target) scroll steps. With `levels`, positions count rows of the visible list, and a change
    of list (another chapter opening) jumps instead of scrolling."""
    visible, previous = settings["visible"], settings["previous"]
    levels = levels or [0] * count

    def where(active):
        rows = visible_rows(levels, active)
        return rows, window_start(rows.index(active) + 1, len(rows), visible, previous)

    start, active = chapter_starts[0]
    rows, target = where(active)
    steps = [(start, target, target)]
    for start, active in chapter_starts[1:]:
        now, target = where(active)
        if now != rows:
            steps.append((start, target, target))
        elif target != steps[-1][2]:
            origin = scroll_position(start, steps[-1:], settings["seconds"])
            steps.append((start, origin, target))
        rows = now
    return steps
