# Demo booth video template

A browser-based **timing editor** for SUSE demo videos. Load your recording, name the chapters, write the on-screen
headlines, and scrub a live preview of the finished layout: a **chapter panel** on the left whose orange button follows
the demo, and a **headline bar** on top where short headlines wipe in from left to right. Everything is saved in one
small JSON file per video, and a command-line renderer turns that file and your recording into the final branded MP4.

You still **cut your video in whatever editor you like**. This app adds the SUSE wrapper around the finished edit.

## How the pieces fit

```
narration ──► LLM prompt ──► headlines ──► timing editor ──► timings/<video>.json ──► renderer ──► final .mp4
 (transcript)  prompts/       (words)       (times, ripple,    (single source          render/        (chapter markers
                                             video preview)     of truth)              render.py       included)
```

| Path | What it is |
|---|---|
| `editor/` | The Vue 3 timing editor, built with Vite into `dist/` for static hosting. |
| `package.json`, `bun.lock`, `vite.config.js` | Editor scripts and locked dependencies, managed with Bun. |
| `start_editor.command` | Double-click to run the editor locally instead of the hosted copy. |
| `timings/*.json` | **All the text and timing for one video**: chapter names, start times, every headline. |
| `render/` | `render.py` (command line), `Containerfile` and `run-container.sh` (SUSE BCI Python image). |
| `prompts/headline-prompt.md` | A ready-to-use LLM prompt that turns narration into headlines. |
| `assets/` | SUSE logo (PNG) and the SUSE Medium font file used by the renderer. |
| `tests/` | Renderer and timing checks, run automatically on every push alongside the editor tests. |

## Quick start

1. **Open the editor.** Use the hosted copy at `https://suse-technical-marketing.github.io/demo-booth-video-template/`
   (once GitHub Pages is enabled, see [Hosting](#hosting-on-github-pages)), or run it locally: double-click
   `start_editor.command` (needs [mise](https://mise.jdx.dev/), or Bun 1.3.14+ and Node.js 24+; Mac only), or from the
   repository root:

   ```bash
   bun install --frozen-lockfile
   bun run dev
   ```

   Then open <http://127.0.0.1:8765/>. The development server binds only to localhost and stops with Ctrl+C. If the
   port is busy, `start_editor.command` tells you what is using it.
2. **Start or open a video.** **New** starts a blank timing file. **Open file…** opens an existing `timings/<video>.json`
   (copy `timings/example.json` to begin from a sample).
3. **Add your recording** with **Add videos…** to preview it under the layout.
4. **Write chapters and headlines** and set their times (see [Using the editor](#using-the-editor)).
5. **Render** the final video (see [Render the finished video](#render-the-finished-video)).

Use **Chrome or Edge** so the page can save straight to your file. Other browsers can open a JSON file and use
**Download** to save a replacement, but cannot link it for autosave or reconnect. Your timing file and videos stay in
your browser and on your own disk: there is no backend and nothing is uploaded.

## Write the headlines

Use the prompt in [`prompts/headline-prompt.md`](prompts/headline-prompt.md). Paste it into your LLM with your
narration transcript and chapter names. It returns a table of short headlines plus a "check these" list
(transcription slips, product names and claims to verify). The rules in that prompt (one headline per beat, 3 to 7
words, accent one or two words, stay faithful to the narration, no absolutes) are the ones this repo's headlines
were written with.

## Using the editor

**New** starts a blank timing file. **Add videos…** loads one or more local videos to preview in the content slot (one per
chapter, or one spanning several): set each one's start time or **snap** it to a chapter. They never leave your computer and
are not saved in the timing file, and the renderer still takes a single video.

On desktop, the editor uses a video-editing workspace: videos, chapters and headlines scroll independently in the left
panel (about 30% of the width), the large preview fits the remaining space without cropping, and the full-width
timeline and playback controls stay docked at the bottom. Headline text fields use the full panel width, with timing,
duration warnings and actions above them. On smaller screens the preview and editing panels stack, while the timeline
remains available at the bottom.

Drag the handle between the editing panel and preview to resize the sidebar (minimum 300 px, maximum 60% of
the desktop workspace). The focused handle also supports Left/Right arrows (10 px), Shift+Left/Right (50 px),
and Home/End for the limits. Double-click it or press Enter to reset to the default 30% split. The divider is
hidden in the stacked small-screen layout. Scrollbars use the editor's dark green theme.

1. Click **Open file…** and pick your `timings/<video>.json` from your clone. The page remembers it, and
   **autosave** writes every change to that file. (First time for a new video? Copy `timings/example.json`, rename
   it, and open the copy.)
2. **Chapters**: the compact list shows each chapter's start, directly editable title and headline count.
   Select a chapter to edit its headlines in the separate **selected-chapter headlines** card below.
   The chapter list and headlines have their own bordered cards and scroll independently.
   An outlined row is the editing selection; a bright dot marks the chapter currently playing.
   Clicking a chapter in the list moves the playhead (and so the timeline and preview) to its start. Enable **Follow playhead** to switch the
   editing panel as playback or scrubbing crosses chapters; focusing an edit field turns following off.
   **+ Chapter** inserts a chapter at the playhead and selects its title for editing. Delete removes the chapter
   and all its headlines; keep at least one chapter. There is no chapter reuse: buttons advance once in chronological order
   through each pass of the looping video. Changing a start time moves its headlines with it and reorders the titles together.
   The selected chapter's **Length** shows its duration until the next chapter or preview end; other rows
   have duration tooltips. The preview end follows loaded videos,
   or the timeline duration when none are loaded; chapters after that end are marked **Past end**.
   The start input's tooltip shows the full timecode.
   Select the **last chapter** to set **Ends at** in its headline card. This is an absolute elapsed end time
   (or a full timecode), not a chapter-relative offset. Leave it blank for automatic end.
   Without loaded videos, it defines the preview timeline's duration; with videos, their actual duration stays
   unchanged while chapter/headline bands stop at this end or the video end, whichever comes first.
   Late headlines are retained with warnings. Undo, Save, Download and Ripple preserve this setting.
   The final chapter button stays highlighted through any remaining video; setting an end does not trim video.
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
4. **Times** accept `3:44` (minutes:seconds), `224` (seconds) or a full timecode like `1:03:44` (set **timeline starts at** in the top bar to the timecode your video editor shows at the start, often `01:00:00`).
   For headline fields, full timecodes are converted to that chapter's relative time;
   the tooltip shows the absolute timecode. `↑` / `↓` nudge by 1 second (`Shift` 5 s, `Alt` 0.1 s).
5. Use a headline's **Preview** button, drag the timeline or press `Space` to preview.
   The timeline has chapter bands and a second track of **headline duration bands**. Each headline band ends
   at its chapter boundary or video end; gaps mean no headline. Selecting a band seeks there and opens its
   chapter/ headline editor. Bands are keyboard-accessible; dragging a band scrubs without moving document timings.
   **To retime a headline, drag the handle on its left edge** (or focus it and press `←` / `→`, `Shift` for 1 s): that moves
   where it starts and where the previous headline in the chapter ends, in 0.1 s steps. A handle stops at its neighbours
   and at the chapter boundary, and the preview follows it. Undo reverts the whole drag.
   Invalid or zero-length cues remain selectable as narrow markers, not misleading duration bands.
   The preview shows the real layout with the active
   button and the wipe. It is an approximation of the rendered video, so check a real frame with `--frame` before a long render.
6. A highlighted **Length** badge indicates **short** (under 3 s) or **long** (over 25 s); its tooltip explains why.
   The longest headline's text-field tooltip says it **sets the shared text size**, which shrinks every headline.
   The preview's size summary also identifies it. Shortening it makes all of
   them bigger.

Other controls: **Save as…** (`Cmd+Shift+S`) writes the current timing to a new file and keeps working in it, leaving the
previous file untouched; **Undo** (`Cmd+Z`), **Download** (if your browser can't link files), **headlines end at** (optional global cutoff),
**wipe** (how long the left-to-right build-in takes), and **Video title and product** (document metadata).
Videos, metadata, headline settings and ripple controls are grouped under **Videos and project settings**
so they do not crowd the chapter/headline editor. Secondary row actions appear on hover or keyboard focus
(and stay visible on touch devices).

For more than six chapters, the sidebar becomes a six-button viewport. At each chapter start it scrolls smoothly
over 0.4 seconds, keeping two previous chapters above the active button and three next chapters below it whenever
possible. At the beginning/end it stays on the first/last six buttons. Arrows indicate more chapters above/below,
and a **Chapter 7 of 12** counter shows progress. This follows video time in the preview and the renderer, including
when scrubbing or jumping backwards during editing. Six or fewer chapters keep the existing static layout.

After saving, run the render command (see [Render the finished video](#render-the-finished-video)).

## Render the finished video

The editor previews the layout; the renderer produces the MP4. It takes your finished edit, puts it in the content
slot, draws the chapter panel and timed headlines from the timing file, keeps your audio, and writes one MP4 chapter
marker per chapter (shown in the chapter menus of QuickTime, VLC and IINA).

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

### In a container (SUSE Base Container Image)

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

## Editing the video afterwards

Re-export the video, use **Ripple** in the editor to slide the times if you cut dead space (put the playhead where you
cut, enter how many seconds you removed as a negative number such as `-8`, and click **Apply**), and render again.
Nothing is stored in the video, so there is nothing to clean up.

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
  "chapters_end": null,
  "wipe_seconds": 0.8
}
```

| Key | Meaning |
|---|---|
| `chapters` | At least one chapter object, ordered by `start`. More than six buttons scroll automatically. |
| `chapters[].title` | Chapter/button name; long names are shrunk to fit. |
| `chapters[].start` | Seconds from the start of the video. |
| `chapters[].headlines` | `[chapter-relative seconds, "text"]` pairs, or `[]` for no headlines. `*word*` = accent. Each headline is clipped at its chapter's end. |
| `headlines_end` | Optional absolute cutoff for all headlines, or `null` to use chapter/video boundaries. |
| `chapters_end` | Optional absolute end of the chapter sequence (at least 0.01 seconds), or `null` for automatic end. Caps chapter/headline ranges and MP4 chapter markers without trimming the rendered video. Also defines preview duration when no videos are loaded. |
| `wipe_seconds` | How long each headline takes to wipe in. |
| `product_name` | Text under the logo. |
| `title`, `schema_version` | For your reference and for future format changes. |

Chapter starts are absolute elapsed seconds; headline times are chapter-relative seconds. For example,
the Blueprint headline above appears at `121 + 5 = 126` seconds. Negative offsets or headlines past a chapter
boundary remain editable with warnings but are never rendered. The renderer validates the file before encoding
and reports skipped out-of-chapter headlines explicitly.

The editor saves schema 2. The editor and the renderer also accept legacy schema-1 files with string chapter
titles, `chapter_starts` and global absolute `headlines`. On import they convert
legacy repeated chapter references into independent chapters, preserving every segment's title and start time.
Titles with no start time are omitted, with an explicit import notice. Each legacy headline is assigned to the chapter
active at its start; no text is carried into the following chapter. Headlines before the first chapter are retained
there as negative offsets and flagged outside the chapter. The editor marks converted files as
unsaved; use **Save** or **Download** to persist the nested schema. The renderer normalizes in memory without
rewriting the source file.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Editor says "sample data" | Click **Open file…** and choose your `timings/*.json`, or **New** to start a blank one. |
| Editor won't save to the file | Use Chrome or Edge. In other browsers use **Download** and replace the file in `timings/`. |
| `start_editor.command` says port 8765 is in use | Close the earlier editor window, or run `kill $(lsof -ti tcp:8765)` and start it again. |
| A video won't load in the preview | The browser can't play that format. Export an H.264 `.mp4`. |
| A headline is marked **outside chapter** | Move its relative time inside the chapter or extend the chapter. The editor keeps its text but the renderer omits it until corrected. |
| Headlines show at the wrong time | Headline times are relative to their chapter; chapter starts are relative to the start of the video. Check both, and use **Ripple** after cuts. |
| `ffmpeg not found` | Run `pip install -r render/requirements.txt` inside your virtual environment (the renderer uses the ffmpeg that package bundles). |
| Colours look different from the preview | Run `--selftest`; its `colour check` line shows the measured error (expect 4 or less). A larger number means a changed encoder setting. |
| Rendered video is silent | Your input has no audio track, or a type ffmpeg can't read. Check with `ffmpeg -i my-edit.mp4`. |
| `Could not read a frame at ...s` | That time is past the end of the video. |
| Logo is replaced by the word "SUSE" | In the editor, the logo could not load from suse.com. In the renderer, `assets/SUSE_Logo-hor_Green.png` is missing. |
| Headline words touch or have big gaps | Nudge `TEXT_SCALE` (default `1.11`) in `render/layout.py` and `editor/src/timing.js`, up if touching, down if gaps. Make sure `assets/fonts/SUSE-Medium.otf` exists. |
| Video doesn't fill the slot | The renderer fits other sizes into the slot with black bars; export 1920 × 1080 for a perfect fit. |

## Customising

Design constants (colours, the sizes and positions of the panel, buttons and headline bar, text sizes) live in
`render/layout.py`, and the editor preview mirrors them in `editor/src/timing.js` and its stylesheet. Everything
content-related lives in `timings/`. A good rule: **if a non-developer might want to change it, it belongs in the JSON;
if it's a design decision, it belongs in the code.**

## Development

```bash
bun install --frozen-lockfile
bun run dev        # editor with hot reload
bun run test       # editor tests (Vitest; not `bun test`, which selects Bun's own runner)
bun run build      # production build into dist/
bun run preview    # serve that build locally
python -m unittest discover -s tests    # renderer and timing tests
mise run test      # everything: editor tests and build, renderer tests, timing files, render self-test
```

The editor's `App.vue` owns document changes, undo, autosave, and playback. `EditorWorkspace`, `ChapterEditor`/`ChapterRow`
and `HeadlineEditor`/`HeadlineRow` handle the editing sections through props and emitted actions; the timeline dock, preview,
video list (`videos.js` holds the clip helpers), time input, and accent text are separate components too. Pure timing and
JSON helpers live in `timing.js`.

### Design decisions

- **Content in JSON.** It's plain text, so it diffs cleanly in git, and one file per video keeps each demo's words and
  timings versioned together.
- **One source of truth.** The editor and the renderer read and write the same file; neither stores a copy.
- **Browser-only editor.** Vue 3 provides reactive UI components; Bun manages dependencies and scripts, with Vite and Node
  handling development and builds. The deployed app needs only static hosting. It loads the SUSE font from Google Fonts and
  the logo from suse.com, so there are no brand assets to host for it; if the logo can't load, the preview shows the word
  "SUSE" instead.
- **Fail early.** The renderer validates the JSON before it encodes anything.

## Hosting on GitHub Pages

The Vue editor builds to static files in `dist/`. The [Pages workflow](.github/workflows/pages.yml) builds, tests,
and deploys them on pushes to `main`, or when run manually. For admins:

1. Repo **Settings → Pages → Build and deployment → Source → GitHub Actions**.
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
