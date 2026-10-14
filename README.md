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
| `editor/` | Vue 3 timing editor, built with Vite into `dist/` for static hosting. |
| `package.json`, `bun.lock` | Editor scripts and locked dependencies, managed with Bun. |
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

### Using mise

If you have [mise](https://mise.jdx.dev/) installed, the repository's [`mise.toml`](mise.toml) selects Python 3.13
and Node.js 24 plus Bun 1.3.14 (the versions used in CI) and provides tasks for setup, rendering, testing, and the local editor. From the repository
root:

```bash
mise install
mise run build my-edit.mp4 -t my-video.json -o my-video-final.mp4
```

The build task installs the renderer dependencies automatically. To check the project, run `mise run test`. To serve
the timing editor locally, run `mise run run` and open <http://127.0.0.1:8765/>; press Ctrl+C to stop the server.
`mise run editor:build` builds the static editor; `mise run editor:test` runs its tests. These tasks install the
locked dependencies with Bun automatically. The existing `build` task still renders videos.

**Colours:** the output is converted with the HD (BT.709) matrix and tagged as such, so SUSE green and orange come
out within a few levels of the brand values in any player. (ffmpeg's default would have turned SUSE green visibly
duller.) `--selftest` measures this and fails if it drifts. Source videos that don't declare their colours are
treated as BT.709, which is what players do.

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

> Tested on Rancher Desktop (Apple silicon): the image builds from `registry.suse.com/bci/python:3.13` (SLES 15 SP7,
> about 480 MB), `--selftest` passes inside it, and a full render through `run-container.sh` kept the audio and the
> frame rate. Inside the Linux VM it renders at roughly 40 to 55 frames per second, slower than running natively on the
> Mac (around 140), so prefer the virtual-environment route on your own machine and the container for servers and CI.

## Write the headlines

Use the prompt in [`prompts/headline-prompt.md`](prompts/headline-prompt.md). Paste it into your LLM with your
narration transcript and chapter names. It returns a table of short headlines plus a "check these" list
(transcription slips, product names and claims to verify). The rules in that prompt (one headline per beat, 3 to 7
words, accent one or two words, stay faithful to the narration, no absolutes) are the ones this repo's headlines
were written with.

## Set the times: the timing editor

**Hosted:** `https://suse-technical-marketing.github.io/demo-booth-video-template/` (once GitHub Pages is enabled,
see [Hosting](#hosting-on-github-pages)).
**Local:** double-click `start_editor.command` (needs mise, or Bun 1.3.14+ and Node.js 24+; Mac only), or run the Vue app from the
repository root:

```bash
bun install --frozen-lockfile
bun run dev
```

Open <http://127.0.0.1:8765/>. The development server binds only to localhost and stops with Ctrl+C. Alternatively,
`mise run run` installs dependencies and starts it. Bun manages packages and scripts; Node runs the Vite/Vitest CLIs.
Both are used only for tooling: timing files still stay in your
browser and on your own disk, with no backend or uploads.

For a production build, run `bun run build` (output: `dist/`). Run `bun run preview` to serve that build locally.
Run `bun run test` for the editor's Vitest regression tests (not `bun test`, which selects Bun's own test runner).

**New** starts a blank timing file. **Add videos…** loads one or more local videos to preview in the content slot (one per
chapter, or one spanning several): set each one's start time or **snap** it to a chapter. They never leave your computer and
are not saved in the timing file; the renderer still takes a single video. Rendered MP4s get one chapter marker per chapter
switch, titled with the chapter name, which players such as QuickTime, VLC and IINA show in their chapter menus.

The editor's `App.vue` owns document changes, undo, autosave, and playback. `ChapterEditor`/`ChapterRow` and
`HeadlineEditor`/`HeadlineRow` handle their editing sections through props and emitted actions; the timeline,
preview, video list (`videos.js` holds the clip helpers), time input, and accent text are separate components too.
Chapter and headline rows share `DurationBadge` for length formatting and past-end warnings.
Pure timing and JSON helpers live in `timing.js`.

On desktop, the editor uses a video-editing workspace: videos, chapters and headlines scroll independently in the left
panel (about 30% of the width), the large preview fits the remaining space without cropping, and the full-width
timeline and playback controls stay docked at the bottom. Headline text fields use the full panel width, with timing,
duration warnings and actions above them. On smaller screens the preview and editing panels stack, while the timeline
remains available at the bottom.

Drag the handle between the editing panel and preview to resize the sidebar (minimum 300 px, maximum 60% of
the desktop workspace). The focused handle also supports Left/Right arrows (10 px), Shift+Left/Right (50 px),
and Home/End for the limits. Double-click it or press Enter to reset to the default 30% split. The divider is
hidden in the stacked small-screen layout. Scrollbars use the editor's dark green theme.

Use **Chrome or Edge** so the page can save straight to your file. Other browsers can open a JSON file and use
**Download** to save a replacement, but cannot link it for autosave or reconnect.

1. Click **Open file…** and pick your `timings/<video>.json` from your clone. The page remembers it, and
   **autosave** writes every change to that file. (First time for a new video? Copy `timings/example.json`, rename
   it, and open the copy.)
2. **Chapters**: the compact list shows each chapter's start, directly editable title and headline count.
   Select a chapter to edit its headlines in the separate **selected-chapter headlines** card below.
   The chapter list and headlines have their own bordered cards and scroll independently.
   An outlined row is the editing selection; a bright dot marks the chapter currently playing.
   Selecting a chapter does not seek or interrupt the preview. Enable **Follow playhead** to switch the
   editing panel as playback or scrubbing crosses chapters; focusing an edit field turns following off.
   **+ Chapter** inserts a chapter at the playhead and selects its title for editing. Delete removes the chapter
   and all its headlines; keep at least one chapter. There is no chapter reuse: buttons advance once in chronological order
   through each pass of the looping video. Changing a start time moves its headlines with it and reorders the titles together.
   The selected chapter's **Length** shows its duration until the next chapter or preview end; other rows
   have duration tooltips. The preview end follows loaded videos,
   or the timeline duration when none are loaded; chapters after that end are marked **Past end**.
   The start input's tooltip retains the absolute Resolve timecode.
3. **Headlines** shows only the selected chapter's headlines. **Add headline** adds to that chapter;
   each time is measured **from the chapter's start**, so `0:05` means five seconds into that chapter.
   A headline ends at the next headline in the same chapter, the chapter boundary, or the video end,
   whichever comes first. Empty chapters and gaps before a chapter's first headline show no text.
   The **Length** badge includes fractional seconds and is capped at the chapter boundary.
   The text appears once, with an explicit **Within chapter** timing label and a `+` before relative times.
   Shortening a chapter retains late headlines with an **outside chapter** warning and a warning on the
   chapter's count; they are not shown
   until you adjust their times or the chapter boundary. Deleting every headline is allowed.
   Wrap words in `*asterisks*` for the orange accent
   (an accent can span several words: `*AI stack*`).
4. **Times** accept `3:44` (minutes:seconds), `224` (seconds) or the timecode Resolve shows, like `1:03:44`.
   For headline fields, full Resolve timecodes are converted to that chapter's relative time;
   the tooltip shows the absolute Resolve timecode. `↑` / `↓` nudge by 1 second (`Shift` 5 s, `Alt` 0.1 s).
5. Use a headline's **Preview** button, drag the timeline or press `Space` to preview.
   The timeline has chapter bands and a second track of **headline duration bands**. Each headline band ends
   at its chapter boundary or video end; gaps mean no headline. Selecting a band seeks there and opens its
   chapter/ headline editor. Bands are keyboard-accessible; dragging scrubs without moving document timings.
   Invalid or zero-length cues remain selectable as narrow markers, not misleading duration bands.
   The preview shows the real layout with the active
   button and the wipe. It's close to Fusion's result but not identical, so do the final check in Resolve.
6. A highlighted **Length** badge indicates **short** (under 3 s) or **long** (over 25 s); its tooltip explains why.
   The longest headline's text-field tooltip says it **sets the shared text size**, which shrinks every headline.
   The preview's size summary also identifies it. Shortening it makes all of
   them bigger.

Other controls: **Undo** (`Cmd+Z`), **Download** (if your browser can't link files), **headlines end at** (optional global cutoff),
**wipe** (how long the left-to-right build-in takes), and **Video title and product** (document metadata).
Videos, metadata, headline settings and ripple controls are grouped under **Videos and project settings**
so they do not crowd the chapter/headline editor. Secondary row actions appear on hover or keyboard focus
(and stay visible on touch devices).

For more than six chapters, the sidebar becomes a six-button viewport. At each chapter start it scrolls smoothly
over 0.4 seconds, keeping two previous chapters above the active button and three next chapters below it whenever
possible. At the beginning/end it stays on the first/last six buttons. Arrows indicate more chapters above/below,
and a **Chapter 7 of 12** counter shows progress. This follows video time in the preview and both renderers, including
when scrubbing or jumping backwards during editing. Six or fewer chapters keep the existing static layout.

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
  "schema_version": 2,
  "title": "SUSE AI Factory demo",
  "product_name": "SUSE AI Factory",
  "chapters": [
    {
      "title": "Apps from SUSE & NVIDIA",
      "start": 0,
      "headlines": [[0, "Tested, supported *applications* for AI"], [18, "..."]]
    },
    {
      "title": "Blueprints",
      "start": 121,
      "headlines": [[5, "Start with a *blueprint*"]]
    }
  ],
  "headlines_end": null,
  "wipe_seconds": 0.8
}
```

| Key | Meaning |
|---|---|
| `chapters` | At least one chapter object, ordered by `start`. More than six buttons scroll automatically. |
| `chapters[].title` | Chapter/button name; long names are shrunk to fit. |
| `chapters[].start` | Seconds from the start of the compound clip. |
| `chapters[].headlines` | `[chapter-relative seconds, "text"]` pairs, or `[]` for no headlines. `*word*` = accent. Each headline is clipped at its chapter's end. |
| `headlines_end` | Optional absolute cutoff for all headlines, or `null` to use chapter/video boundaries. |
| `wipe_seconds` | How long each headline takes to wipe in. |
| `product_name` | Text under the logo. |
| `title`, `schema_version` | For your reference and for future format changes. |

Chapter starts are absolute elapsed seconds; headline times are chapter-relative seconds. For example,
the Blueprint headline above appears at `121 + 5 = 126` seconds. Negative offsets or headlines past a chapter
boundary remain editable with warnings but are never rendered. The script validates the file before building
and reports skipped out-of-chapter headlines explicitly.

The editor saves schema 2. The editor and both renderers also accept legacy schema-1 files with string chapter
titles, `chapter_starts` and global absolute `headlines`. On import they convert
legacy repeated chapter references into independent chapters, preserving every segment's title and start time.
Titles with no start time are omitted, with an explicit import notice. Each legacy headline is assigned to the chapter
active at its start; no text is carried into the following chapter. Headlines before the first chapter are retained
there as negative offsets and flagged outside the chapter. The editor marks converted files as
unsaved; use **Save** or **Download** to persist the nested schema. Renderers normalize in memory without
rewriting the source file.

## Troubleshooting

| Symptom | Fix |
|---|---|
| The orange button never changes | Re-run the latest script and read the `check` lines. Each must say **ok**. If one says **WRONG**, send the Console output to whoever maintains this repo. |
| Headlines show at the wrong time | Headline times are relative to their chapter; chapter starts are relative to the compound clip. Check both, and use **Ripple** after cuts. |
| Console: `Could not find the demo-booth-video-template folder` | Set `REPO_DIR` at the top to the folder that contains `assets/` and `timings/`. |
| Console: `Could not read ... timings/...json` | `TIMING_NAME` at the top of the script doesn't match a file in `timings/`. |
| Console: `chapter switch ... points to chapter ...` | A legacy chapter number refers to a missing title. Correct the timing file, then reopen it. |
| A headline is marked **outside chapter** | Move its relative time inside the chapter or extend the chapter. The editor keeps its text but both renderers omit it until corrected. |
| Text is Times/serif or the wrong font | Path A: the SUSE font isn't installed, or Resolve wasn't restarted after installing it. Path B needs no installed font. |
| Path B: `ffmpeg not found` | Run `pip install -r render/requirements.txt` inside your virtual environment (the renderer uses the ffmpeg that package bundles). |
| Path B: colours look different from the preview | Run `--selftest`; its `colour check` line shows the measured error (expect 4 or less). A larger number means a changed encoder setting. |
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
- **Browser-only editor.** Vue 3 provides reactive UI components; Bun manages dependencies and scripts, with Vite
  and Node handling development and builds.
  The deployed app needs only static hosting, not a Node backend: your timing file is read and written locally.
  It loads the SUSE font from Google Fonts and the logo from suse.com, so there are no brand assets to host for it.
  If the logo ever can't load, the preview shows the word "SUSE" instead. (Fusion can't use web fonts or an SVG
  logo, which is why `assets/` still contains a PNG logo and the font file.)
- **Fail early.** The script validates the JSON before it builds anything.
- **Safe to re-run.** The script cleans up after itself, so iterating is just "save, paste".
- **Two renderers, one layout.** The Fusion script and `render/` hold the same constants (`render/layout.py`
  mirrors the top of the Fusion script). `tests/check_layout_sync.py` fails if they drift, and it runs in CI.

## Hosting on GitHub Pages

The Vue editor builds to static files in `dist/`. The [Pages workflow](.github/workflows/pages.yml) builds, tests,
and deploys them on pushes to `main`, or when run manually. For admins:

1. Repo **Settings → Pages → Build and deployment → Source → GitHub Actions** (replace the old `/docs` branch setup).
2. Push to `main`, or run **Deploy timing editor** from the **Actions** tab.
3. The site appears at `https://suse-technical-marketing.github.io/demo-booth-video-template/`.

Vite uses relative asset URLs, so the same `dist/` works at the repository's Pages URL or another static host.
Generated build files are ignored by git; the workflow publishes an artifact, not committed bundles.

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
