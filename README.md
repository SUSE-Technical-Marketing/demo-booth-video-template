# Demo booth video template

Turn a screen recording into a branded booth demo video: a **chapter panel** on the left whose orange button
follows the demo, and a **headline bar** on top where short headlines wipe in from left to right.

You control every word and every time in a small **web page** (the timing editor), so changing a headline never
means touching code. Then you produce the video one of **two ways**, from the same timing file:

| | **Path A: DaVinci Resolve** | **Path B: Python renderer** |
|---|---|---|
| You do | Compound clip, paste a script into Fusion's Console | `python render/render.py cut.mp4 -t my-video.json` |
| Needs | DaVinci Resolve, SUSE font installed | Python (or just a container engine), nothing else |
| Preview | Live in Resolve | A single frame as a PNG, or the editor's preview |
| Good for | One-off videos you want to keep tweaking visually | Repeatable runs, many videos, servers or CI |
| Result | Layout lives on the clip inside Resolve | A finished MP4 |

You still **cut your video in whatever editor you like**; both paths start from your finished edit.

![Example of the finished layout](docs/img/finished-layout.png)
> 📷 *Screenshot to add: one finished frame (panel on the left, headline on top, your recording in the slot).*

## How the pieces fit

```
narration ──► LLM prompt ──► headlines ──► timing editor ──► timings/<video>.json ─┬─► Path A: Fusion script ──► video in DaVinci
 (transcript)  prompts/       (words)       (times, ripple)    (single source      │      fusion/build_chapter_template.py
                                                                of truth)         └─► Path B: Python renderer ──► final .mp4
                                                                                         render/render.py (+ container)
```

| Path | What it is |
|---|---|
| `fusion/build_chapter_template.py` | **Path A.** The script you paste into Resolve's Fusion Console. Builds the whole layout. |
| `render/` | **Path B.** `render.py` (command line), `Containerfile` and `run-container.sh` (SUSE BCI Python image). |
| `tests/` | Checks that both paths use the same layout, run automatically on every push. |
| `timings/*.json` | **All the text and timing for one video**: button names, when the orange button switches, every headline. |
| `docs/index.html` | The timing editor (also what GitHub Pages serves). |
| `prompts/headline-prompt.md` | A ready-to-use LLM prompt that turns narration into headlines. |
| `assets/` | SUSE logo (PNG for Fusion) and the SUSE Medium font file used to measure text widths. |
| `start_editor.command` | Double-click to run the editor locally instead of the hosted copy. |

## One-time setup

1. **Clone this repo** anywhere (GitHub Desktop's default, `~/Documents/GitHub/`, is fine). The script finds the
   repo folder by itself, including its logo and font, so you never type a path. The Console prints
   `Using repo: ...` so you can see which folder it picked.
2. **Path A only: install the SUSE font** (Regular, Medium and SemiBold) and **restart Resolve**. It's open source: get it from
   [Google Fonts](https://fonts.google.com/specimen/SUSE) or the [SUSE font repo](https://github.com/SUSE/suse-font).
   Fusion can only use fonts installed on your Mac, which is why the script needs it even though the editor loads
   it from the web.
3. **Use a 1920 × 1080 timeline.** The layout is built in those pixels.

## Path A: make the video in DaVinci Resolve (step by step)

### 1. Edit your video first, then make it one compound clip

Finish your edit before you add headlines (cut dead space, trim, order the clips). Headline times are measured
from the start of the clip, so cutting afterwards moves the picture away from the headlines. (If you do need to
cut later, see [Editing the video afterwards](#editing-the-video-afterwards).)

1. On the **Edit** page, select **all** the clips that make up the video (`Cmd+A` in the timeline).
2. Right-click one of them → **New Compound Clip…** → give it a name → **Create**.
3. Make sure the compound clip starts at the beginning of your timeline (usually `01:00:00:00`). The editor
   assumes this when you type Resolve timecodes.

> 📷 *Screenshot to add: clips selected, right-click menu showing "New Compound Clip…".*

### 2. Open it on the Fusion page

Select the compound clip, then click **Fusion** in the page bar at the bottom of Resolve. You'll see one node
called `MediaIn1` (your video) feeding `MediaOut1`.

> 📷 *Screenshot to add: the Fusion page with MediaIn1 → MediaOut1.*

### 3. Open the Console

In the menu bar: **Workspace → Console**. At the top of the Console panel, switch the language to **Py3**.

> If Py3 shows errors about Python not being found, install Python 3 and restart Resolve.

> 📷 *Screenshot to add: Workspace > Console menu, and the Py3 switch in the Console panel.*

### 4. Run the script

1. Open `fusion/build_chapter_template.py` in any text editor.
2. At the top, check the **WHERE THINGS ARE** block. The only thing to set is `TIMING_NAME`: which file in
   `timings/` to build from (for example `my-video.json`). Leave `REPO_DIR` empty. Only if the repo lives in an
   unusual place and the Console says it can't find it, set `REPO_DIR` to that folder.
3. Select all, copy, paste into the Console, press **Enter**.

The Console prints one line per chapter and per headline with its start frame, then a few `check` lines. Each
`check` line should end in **ok**. The finished layout appears in the viewer, with your video in the content slot.

> 📷 *Screenshot to add: Console output ending in "SUSE chapter template built".*

### 5. Look at it

Press play or drag the playhead. At each chapter start the orange button should step down the list, and each
headline should wipe in at its time.

### Changing something later

Edit the timing file in the editor (next section), save, then **paste the script again**. It deletes its own old
nodes first, so re-running never stacks copies. Nothing else to do.

## Path B: make the video with the Python renderer (no DaVinci)

1. **Cut and export your video** from any editor as a normal MP4 (1920 × 1080 is ideal; other sizes are fitted into
   the slot with black bars). Cut dead space first, because times are measured from the start of this file.
2. **One-time setup** (needs Python 3.10 or newer; nothing else, the renderer brings its own ffmpeg):
   ```bash
   cd demo-booth-video-template
   python3 -m venv .venv
   .venv/bin/pip install -r render/requirements.txt
   ```
3. **Check a frame before rendering everything.** This writes one PNG of the finished layout at 75 seconds:
   ```bash
   .venv/bin/python render/render.py my-edit.mp4 -t my-video.json --frame 75 --png check.png
   ```
   (`-t` takes a file name from `timings/` or a path. Without a video it draws a grey slot, which is handy for
   checking only the headlines and buttons.)
4. **Render:**
   ```bash
   .venv/bin/python render/render.py my-edit.mp4 -t my-video.json -o my-video-final.mp4
   ```
   Progress prints as it goes. It keeps your audio (re-encoded to AAC), keeps the frame rate, and outputs 1920 × 1080
   H.264. On Apple-silicon Macs add `--fast` to use the hardware encoder.
5. **Changing something later:** edit the timing file in the editor, save, and re-run step 4. Nothing is stored in
   the video, so there is nothing to clean up. If you re-cut the video, re-export it and use the editor's
   **Ripple** tool to slide the times.

Other options: `--start 30 --duration 60` renders just that part (timing times still count from the start of the
source), `--fps 30`, `--crf 18` (quality; lower is better) and `--preset medium`. `--selftest` renders a generated
clip to prove the install works.

**Speed:** the check on a generated 1080p clip rendered at roughly 140 frames per second on an Apple-silicon Mac, so
a ten minute video takes a few minutes. Your numbers will vary with the source video and the machine.

### Path B in a container (SUSE Base Container Image)

If you would rather not install anything, or you want to render on a server, the renderer runs in a container built on
`registry.suse.com/bci/python`. Pillow and a static ffmpeg come from pip, so the image needs no extra repositories.

```bash
cd ~/Movies/my-demo        # the folder that holds your edited video
/path/to/demo-booth-video-template/render/run-container.sh my-edit.mp4 -t my-video.json -o final.mp4
```

The script builds the image the first time (`docker`, `podman` or `nerdctl`; set `CONTAINER_ENGINE` to choose),
mounts the current folder at `/work` and your repo's `timings/` folder read-only, so timing edits need no rebuild.
To build it yourself: `docker build -t booth-render -f render/Containerfile .` from the repo root.

> The container files are written but have not been run yet. If the build fails, send the error to whoever
> maintains this repo.

## Write the headlines

Use the prompt in [`prompts/headline-prompt.md`](prompts/headline-prompt.md). Paste it into your LLM with your
narration transcript and chapter names. It returns a table of short headlines plus a "check these" list
(transcription slips, product names and claims to verify). The rules in that prompt (one headline per beat, 3 to 7
words, accent one or two words, stay faithful to the narration, no absolutes) are the ones this repo's headlines
were written with.

## Set the times: the timing editor

**Hosted:** `https://suse-technical-marketing.github.io/demo-booth-video-template/` (once GitHub Pages is enabled,
see [Hosting](#hosting-on-github-pages)).
**Local:** double-click `start_editor.command` (needs Python 3; Mac only).

Use **Chrome or Edge** so the page can save straight to your file.

1. Click **Open file…** and pick your `timings/<video>.json` from your clone. The page remembers it, and
   **autosave** writes every change to that file. (First time for a new video? Copy `timings/example.json`, rename
   it, and open the copy.)
2. **Chapter buttons**: add a row for each moment the orange button should switch, and pick which button.
3. **Headlines**: one row each. Type the time and the words. Wrap words in `*asterisks*` for the orange accent
   (an accent can span several words: `*AI stack*`).
4. **Times** accept `3:44` (minutes:seconds), `224` (seconds) or the timecode Resolve shows, like `1:03:44`.
   `↑` / `↓` nudge by 1 second (`Shift` 5 s, `Alt` 0.1 s).
5. Click a row, drag the timeline or press `Space` to preview. The preview shows the real layout with the active
   button and the wipe. It's close to Fusion's result but not identical, so do the final check in Resolve.
6. Watch the chips: **short** (under 3 s on screen) and **long** (over 25 s) are worth a second look, and the
   headline marked **sets text size** is the longest, which shrinks every headline. Shortening it makes all of
   them bigger.

Other controls: **Undo** (`Cmd+Z`), **Download** (if your browser can't link files), **last headline ends at**,
**wipe** (how long the left-to-right build-in takes), and **Names** (video title, product name, the six button
labels).

After saving, re-run the script in Resolve (Path A) or the render command (Path B).

## Editing the video afterwards

**Path B:** re-export the video, use **Ripple** in the editor if you cut, and render again. Nothing else.

**Path A:** the template belongs to the compound clip. So if you change the video after adding headlines:

**Only the timing moved (you cut dead space or trimmed):**
1. Make a backup first: duplicate your timeline (right-click it in the Media Pool → **Duplicate Timeline**).
2. Edit as needed. On a compound clip, **right-click → Decompose in Place** gives you the original clips back.
   Make your cuts.
3. Select all the clips again → **New Compound Clip…**, open the Fusion page, re-run the script.
4. In the editor, use **Ripple**: put the playhead where you cut, enter how many seconds you removed (a
   negative number, for example `-8`), and click **Apply**. Everything after that point slides earlier in one
   step. Check a few headlines, then re-run the script.

Plan on re-creating the compound clip and re-running the script after you decompose. That is quick, because the
words and timings live in the JSON file and the script rebuilds the whole layout from it.

> 📷 *Screenshot to add: right-click menu with "Decompose in Place".*

## Start over / remove the template from a clip

- **Easiest:** just re-run the script. Its first step deletes every node except `MediaIn` and `MediaOut`
  (`CLEAN_RERUN = True` near the top; set it to `False` if a clip has your own extra nodes that must stay).
- **To remove the template entirely:** on the Fusion page click an empty area of the node graph, `Cmd+A` to select
  everything, then hold `Cmd` and click `MediaIn1` and `MediaOut1` to deselect them, and press `Delete`. Then
  reconnect `MediaIn1` to `MediaOut1` (drag from one node's output to the other's input) so your plain video
  shows again.

## Timing file format

`timings/<video>.json`. The editor writes it for you; you can also edit it in any text editor.

```json
{
  "schema_version": 1,
  "title": "SUSE AI Factory demo",
  "product_name": "SUSE AI Factory",
  "chapters": ["Apps from SUSE & NVIDIA", "Blueprints", "..."],
  "chapter_starts": [[0, 1], [121, 2]],
  "headlines": [[0, "Tested, supported *applications* for AI"], [18, "..."]],
  "headlines_end": null,
  "wipe_seconds": 0.8
}
```

| Key | Meaning |
|---|---|
| `chapters` | Names of the left-hand buttons (1 to 6). Long names are shrunk to fit. |
| `chapter_starts` | `[seconds, button number]`: from that second, that button is orange. |
| `headlines` | `[seconds, "text"]`: shown from that second until the next headline. `*word*` = accent. |
| `headlines_end` | Second at which the last headline goes away, or `null` to keep it to the end of the clip. |
| `wipe_seconds` | How long each headline takes to wipe in. |
| `product_name` | Text under the logo. |
| `title`, `schema_version` | For your reference and for future format changes. |

Seconds are measured from the start of the compound clip. The script checks the file when it starts and stops with a
plain message if, for example, a chapter switch points at a button that doesn't exist.

## Troubleshooting

| Symptom | Fix |
|---|---|
| The orange button never changes | Re-run the latest script and read the `check` lines. Each must say **ok**. If one says **WRONG**, send the Console output to whoever maintains this repo. |
| Headlines show at the wrong time | Times are from the start of the compound clip. Re-check that the clip starts at the timeline start, and use **Ripple** after cuts. |
| Console: `Could not find the demo-booth-video-template folder` | Set `REPO_DIR` at the top to the folder that contains `assets/` and `timings/`. |
| Console: `Could not read ... timings/...json` | `TIMING_NAME` at the top of the script doesn't match a file in `timings/`. |
| Console: `chapter switch ... points to chapter 7` | Chapter numbers go 1 to 6 only. Fix the row in the editor. |
| Text is Times/serif or the wrong font | Path A: the SUSE font isn't installed, or Resolve wasn't restarted after installing it. Path B needs no installed font. |
| Path B: `ffmpeg not found` | Run `pip install -r render/requirements.txt` inside your virtual environment (the renderer uses the ffmpeg that package bundles). |
| Path B: rendered video is silent | Your input has no audio track, or a type ffmpeg can't read. Check with `ffmpeg -i my-edit.mp4`. |
| Path B: `Could not read a frame at ...s` | That time is past the end of the video. |
| Logo is replaced by the word "SUSE" | `assets/SUSE_Logo-hor_Green.png` is missing from the repo folder the Console reported. |
| Headline words touch or have big gaps | Nudge `TEXT_SCALE` (default `1.11`) near the top of the script, up if touching, down if gaps. Make sure `assets/fonts/SUSE-Medium.otf` exists. |
| Video doesn't fill the slot | The script assumes a 1920 × 1080 source. |
| Editor says "sample data" | Click **Open file…** and choose your `timings/*.json`. |
| Editor won't save to the file | Use Chrome or Edge. In other browsers use **Download** and replace the file in `timings/`. |

## Customising

Everything design-related is a named constant at the top of the script: colours (`BRAND`), the sizes and
positions of the panel, buttons and headline bar (`PANEL`, `PILL`, `BAR`, `CONTENT`), and text sizes. Everything
content-related lives in `timings/`. A good rule: **if a non-developer might want to change it, it belongs in the
JSON; if it's a design decision, it belongs in the script.**

## Design decisions

- **Content in JSON, not Python.** Resolve's Python has no extra packages, and JSON is built in. It's plain text, so
  it diffs cleanly in git, and one file per video keeps each demo's words and timings versioned together.
  YAML or CSV would need an extra parser or can't hold the nested rows.
- **One source of truth.** The editor and the script read and write the same file; neither stores a copy.
- **Browser-only editor.** The page has no server and sends nothing anywhere: your file is read and written locally.
  It loads the SUSE font from Google Fonts and the logo from suse.com, so there are no brand assets to host for it.
  If the logo ever can't load, the preview shows the word "SUSE" instead. (Fusion can't use web fonts or an SVG
  logo, which is why `assets/` still contains a PNG logo and the font file.)
- **Fail early.** The script validates the JSON before it builds anything.
- **Safe to re-run.** The script cleans up after itself, so iterating is just "save, paste".
- **Two renderers, one layout.** The Fusion script and `render/` hold the same constants (`render/layout.py`
  mirrors the top of the Fusion script). `tests/check_layout_sync.py` fails if they drift, and it runs in CI.

## Hosting on GitHub Pages

The editor is a single static file, `docs/index.html`, so it can be published from the repo. For admins:

1. Repo **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, folder `/docs`.
2. The site appears at `https://suse-technical-marketing.github.io/demo-booth-video-template/`.

Things to decide first:
- **Pages on a private repo needs a paid GitHub plan.** On a free organisation, Pages only works for a
  **public** repo.
- **If the repo is public, so is everything in it**, including `timings/*.json` (your headlines), the prompt and the
  logo file. The hosted editor itself contains only neutral sample data, never your real timings. Check with your
  marketing and legal contacts before making the repo public, or keep real timing files in a private repo.

## Credits and licences

- Code: MIT, see [LICENSE](LICENSE).
- **SUSE typeface**: SIL Open Font License 1.1, see [`assets/fonts/OFL.txt`](assets/fonts/OFL.txt).
  Source: <https://github.com/SUSE/suse-font>.
- **SUSE logo**: SUSE trademark; use under SUSE's brand guidelines.
