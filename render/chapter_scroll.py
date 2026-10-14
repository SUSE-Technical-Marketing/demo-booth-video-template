"""Timeline-driven chapter scrolling shared by the renderer and the Fusion builder."""


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


def fusion_scroll_expression(steps, fps, t0, seconds):
    """Express the same easing in Fusion frame time, including interrupted scrolls."""
    expression = str(steps[0][2])
    for start, origin, target in steps[1:]:
        frame = t0 + start * fps
        duration = seconds * fps
        p = "((time - %.12g) / %.12g)" % (frame, duration)
        tween = "%.12g + %.12g * %s * %s * (3 - 2 * %s)" % (origin, target - origin, p, p, p)
        expression = "iif(time < %.12g, (%s), iif(time >= %.12g, %d, (%s)))" % (
            frame, expression, frame + duration, target, tween)
    return expression
