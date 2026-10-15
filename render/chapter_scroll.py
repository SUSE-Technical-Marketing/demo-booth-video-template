"""Timeline-driven chapter scrolling for the renderer (the editor preview mirrors it in timing.js)."""


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


def scroll_steps(chapter_starts, count, settings):
    visible, previous = settings["visible"], settings["previous"]
    start, active = chapter_starts[0]
    target = window_start(active, count, visible, previous)
    steps = [(start, target, target)]
    for start, active in chapter_starts[1:]:
        target = window_start(active, count, visible, previous)
        if target != steps[-1][2]:
            origin = scroll_position(start, steps[-1:], settings["seconds"])
            steps.append((start, origin, target))
    return steps

