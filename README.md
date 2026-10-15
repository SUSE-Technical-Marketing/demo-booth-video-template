# Demo booth video template

A browser-based **timing editor** for SUSE demo videos. Load your recording, name the chapters, write the on-screen
headlines, and scrub a live preview of the finished layout: a **chapter panel** on the left whose orange button follows
the demo, and a **headline bar** on top where short headlines wipe in from left to right. Everything is saved in one
project JSON per video, and a command-line renderer assembles its source clips into the final branded MP4.

Use an external video editor for complex editing, or arrange and trim clips here with hard cuts.
Crossfades and other transitions are not supported yet.

For planned technical and functional work, see the [improvement roadmap](IMPROVEMENTS.md).

## What you can do in the editor

- **Preview the real layout** over your own recordings: load one video per chapter, or one that spans several, and play
  or scrub the finished look.
- **Edit chapters and headlines** in a focused workspace: rename chapters inline, add as many as you need (the panel
  scrolls past six), and write headlines with `*accent*` words.
- **Retime on the timeline**: drag a headline's start and end handles, zoom in for precision, click a chapter to jump
  there, and ripple everything after a cut.
- **Keep your work safe**: autosave to a linked file, **Save as…** for copies, **New** for a blank start, and Undo.
- **Save complete projects**: source media paths, clip placements and trims, output frame rate, chapters and headlines.
- **Render the final MP4** with one command (or a container): multiple clips, gaps, branded layout, your audio, and an MP4 chapter marker
  per chapter.

## How the pieces fit

```
narration ──► LLM prompt ──► headlines ──► timing editor ──► timings/<video>.json ──► renderer ──► final .mp4
 (transcript)  prompts/       (words)       (times, clips,     (single source          render/        (chapter markers
                                             video preview)     of truth)              render.py       included)
```

| Path | What it is |
|---|---|
| `editor/` | The Vue 3 timing editor, built with Vite into `dist/` for static hosting. |
| `package.json`, `bun.lock`, `vite.config.js` | Editor scripts and locked dependencies, managed with Bun. |
| `start_editor.command` | Double-click to run the editor locally instead of the hosted copy. |
| `timings/*.json` | Example project documents with chapters and headlines. Add your media before rendering. |
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
2. **Start or open a project.** **New** starts a blank project. **Open file…** opens an existing project JSON
   (copy `timings/example.json` to begin from a sample).
3. **Add your recordings** in **Videos & settings**. Set timeline starts, source **In/Out** trims and relative media paths.
4. **Write chapters and headlines** and set their times (see [Using the editor](#using-the-editor)).
5. **Save** the project next to its media, then **render** it (see [Render the finished video](#render-the-finished-video)).

Use **Chrome or Edge** so the page can save straight to your file. Other browsers can open a JSON file and use
**Download** to save `project.json`, but cannot link it for autosave or reconnect. Your project and videos stay in
your browser and on your own disk: there is no backend and nothing is uploaded.

## Write the headlines

Use the prompt in [`prompts/headline-prompt.md`](prompts/headline-prompt.md). Paste it into your LLM with your
narration transcript and chapter names. It returns a table of short headlines plus a "check these" list
(transcription slips, product names and claims to verify). The rules in that prompt (one headline per beat, 3 to 7
words, accent one or two words, stay faithful to the narration, no absolutes) are the ones this repo's headlines
were written with.

## Using the editor

**New** starts a blank project. **Add videos…** places local videos sequentially in the content slot.
Change a clip's timeline start or **snap** it to a chapter, and set source **In/Out** to use part of a recording.
Clips cannot overlap; hard cuts are supported, and gaps render black with silence. Chapters and clips are independent:
one chapter can span several clips, and one clip can span several chapters.

The project saves media references and clip data, never video bytes or temporary browser URLs. **Media path** is relative
to the saved project JSON, using forward slashes, for example `media/demo.mp4`. Newly added files default to their filename:
save the project beside them, or update their paths. After reopening, use each clip's **Relink media…** button to select
the local source again for preview. Relinking does not change its saved path or trims. Missing media does not prevent
editing or saving the project; rendering requires all referenced clips' media. Save as into a different directory requires
keeping the same relative media layout or updating the paths.

Choose the render frame rate in **Videos & settings**. The renderer normalizes source sizes/frame rates and audio;
the final output is 1920 × 1080 with stereo 48 kHz audio. Source clips without audio and timeline gaps produce silence.

### Fullscreen booth playback (no export required)

After adding or relinking all videos, click the orange **Play fullscreen loop** button in the main header. The full branded composition
starts at the beginning and repeats continuously: clip placements and source trims, chapters, headline wipes and
chapter scrolling all remain active. The 16:9 layout fits the display without cropping, with black letterboxing where
needed. Timeline gaps are black and silent, without editor placeholder labels.

Playback starts **muted**. Move the pointer to reveal **Enable audio**, pause/play and exit controls; the controls and
pointer disappear after three seconds of inactivity while playing. `Space` pauses/resumes; `Escape` exits fullscreen
and pauses at the current position. Presentation settings do not change the saved project. Missing media must be
relinked before starting; playback/decoding failures pause playback and display an error instead of silently looping.
Buffering pauses the presentation clock so chapters and headlines do not run ahead of a waiting video.

Keep the browser in the foreground and disable the computer's screen sleep/screensaver for unattended playback.
Browser playback uses the display's refresh rate, available codecs, browser audio handling and CSS/text rendering;
it is not a frame-identical replacement for the renderer. The preview's remote SUSE logo/font resources also require
network access (fallbacks are used if unavailable). Use an exported MP4 for TV/USB players, offline portability,
precise frame-rate/color/audio normalization, or more predictable playback on different hardware.

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
   **To move where a chapter starts, drag the handle on the left edge of its band** (the dark bar at the top of the timeline): the
   previous chapter ends there and the chapter's headlines move with it, because they are measured from its start.
   **To change when a headline's words appear and disappear, drag the handles on its band**: the left handle
   sets when it starts (and so where the previous headline in the chapter ends), the right handle sets when it ends, which
   can leave a gap before the next headline. Dragging the right handle all the way to the next headline (or the chapter
   end) makes the end automatic again. Handles can also be focused and moved with `←` / `→` (`Shift` for 1 s), move in 0.1 s steps,
   stop at their neighbours and the chapter boundary, and the preview follows. Undo reverts the whole drag.
   Invalid or zero-length cues remain selectable as narrow markers, not misleading duration bands.
   The preview shows the real layout with the active
   button and the wipe. It is an approximation of the rendered video, so check a real frame with `--frame` before a long render.
6. A highlighted **Length** badge indicates **short** (under 3 s) or **long** (over 25 s); its tooltip explains why.
   The longest headline's text-field tooltip says it **sets the shared text size**, which shrinks every headline.
   The preview's size summary also identifies it. Shortening it makes all of
   them bigger.

**Videos on the timeline:** loaded videos appear as a labelled row above the chapter names, showing where each one plays
and for how long. Use the **Videos** toggle in the timeline toolbar to show or hide that row (it remembers your choice).
Drag a video's **left handle** to trim its beginning: its timeline start and source In move together, keeping its
end fixed. Drag its **right handle** to adjust source Out, keeping its start fixed. Neither trim moves chapters,
headlines or other clips. Handles stop at neighbouring clips and source limits; relink missing media before extending
the right edge beyond its saved Out point. Use `←` / `→` for 0.1 s adjustments (`Shift` for 1 s).
The preview and In/Out fields follow the trim, and **Undo** reverts the whole drag.

**Zoom** the timeline with the **− / + / Fit** buttons above it (or Ctrl/Cmd + scroll, or a trackpad pinch) to place handles
precisely: each step doubles the zoom, the ruler adds finer ticks, and the view scrolls to keep the playhead visible.

Other controls: **Save as…** (`Cmd+Shift+S`) writes the current timing to a new file and keeps working in it, leaving the
previous file untouched; **Undo** (`Cmd+Z`), **Download** (if your browser can't link files), **headlines end at** (optional global cutoff),
**wipe** (how long the left-to-right build-in takes), and **Video title and product** (document metadata).
The left panel has two tabs: **Chapters & headlines** for timing edits, and **Videos & settings** for
videos, metadata, headline settings and ripple controls. Switching tabs preserves your edits and selection;
selecting a chapter or headline on the timeline returns to its editing tab. Use Left/Right arrows or Home/End
when a tab is focused to switch tabs. Secondary row actions appear on hover or keyboard focus
(and stay visible on touch devices).

For more than six chapters, the sidebar becomes a six-button viewport. At each chapter start it scrolls smoothly
over 0.4 seconds, keeping two previous chapters above the active button and three next chapters below it whenever
possible. At the beginning/end it stays on the first/last six buttons. Arrows indicate more chapters above/below,
and a **Chapter 7 of 12** counter shows progress. This follows video time in the preview and the renderer, including
when scrubbing or jumping backwards during editing. Six or fewer chapters keep the existing static layout.

After saving, run the render command (see [Render the finished video](#render-the-finished-video)).

## Render the finished video

The editor previews the layout; the renderer produces the MP4. It assembles the clips from your project, puts them in the content
slot, draws the chapter panel and timed headlines, keeps your audio, and writes one MP4 chapter
marker per chapter (shown in the chapter menus of QuickTime, VLC and IINA).

1. **Arrange and save your project.** For example:
   ```
   my-demo/
     project.json
     media/
       intro.mp4
       demo.mp4
   ```
   The media paths in this project are `media/intro.mp4` and `media/demo.mp4`.
   Paths resolve relative to the project file, not your shell's working directory.
2. **One-time setup** (needs Python 3.10 or newer; nothing else, the renderer brings its own ffmpeg):
   ```bash
   cd demo-booth-video-template
   python3 -m venv .venv
   .venv/bin/pip install -r render/requirements.txt
   ```
3. **Check a frame before rendering everything.** This writes one PNG of the finished layout at 75 seconds:
   ```bash
   .venv/bin/python render/render.py /path/to/my-demo/project.json --frame 75 --png check.png
   ```
   An empty project's frame preview draws a grey placeholder for checking the layout.
4. **Render:**
   ```bash
   .venv/bin/python render/render.py /path/to/my-demo/project.json -o my-video-final.mp4
   ```
   Progress prints as it goes. It keeps clip audio (re-encoded to AAC), uses the project's frame rate, and outputs 1920 × 1080
   H.264. On Apple-silicon Macs add `--fast` to use the hardware encoder.
5. **Changing something later:** edit the project in the editor, save, and re-run step 4. Nothing is stored in
   the video, so there is nothing to clean up. If you re-cut the video, re-export it and use the editor's
   **Ripple** tool to slide the times.

Other options: `--start 30 --duration 60` renders just that part (chapter/headline times still count from the start of the
project), `--crf 18` (quality; lower is better) and `--preset medium`. `--selftest` renders a generated
clip to prove the install works.

### Using mise

If you have [mise](https://mise.jdx.dev/) installed, the repository's [`mise.toml`](mise.toml) selects Python 3.13
and Node.js 24 plus Bun 1.3.14 (the versions used in CI) and provides tasks for setup, rendering, testing, and the local editor. From the repository
root:

```bash
mise install
mise run build /path/to/my-demo/project.json -o my-video-final.mp4
```

The build task installs the renderer dependencies automatically. To check the project, run `mise run test`. To serve
the timing editor locally, run `mise run run` and open <http://127.0.0.1:8765/>; press Ctrl+C to stop the server.
`mise run editor:build` builds the static editor; `mise run editor:test` runs its tests. These tasks install the
locked dependencies with Bun automatically. The existing `build` task still renders videos.

**Colours:** the output is converted with the HD (BT.709) matrix and tagged as such, so SUSE green and orange come
out within a few levels of the brand values in any player. (ffmpeg's default would have turned SUSE green visibly
duller.) `--selftest` measures this and fails if it drifts. Source videos that don't declare their colours are
treated as BT.709, which is what players do.

**Temporary storage:** rendering first builds a lossless FFV1/PCM master, then applies branding and encodes the final MP4.
The master and segment files are removed on completion or failure. Allow substantial temporary disk space for long projects.
Source footage is not repeatedly lossy-encoded. Assembly currently also runs for single-frame checks of projects with clips.

### In a container (SUSE Base Container Image)

If you would rather not install anything, or you want to render on a server, the renderer runs in a container built on
`registry.suse.com/bci/python`. Pillow and a static ffmpeg come from pip, so the image needs no extra repositories.

```bash
cd ~/Movies/my-demo        # project.json and its media/ subfolder
/path/to/demo-booth-video-template/render/run-container.sh project.json -o final.mp4
```

The script builds the image the first time (`docker`, `podman` or `nerdctl`; set `CONTAINER_ENGINE` to choose),
mounts the current folder at `/work` and the project file's directory, so project edits need no rebuild.
Keep referenced media inside that project directory for container use; parent-directory references outside the mounted folder
are supported by the native renderer but need an additional mount when running a container manually.
To build it yourself: `docker build -t booth-render -f render/Containerfile .` from the repo root.

The container uses `registry.suse.com/bci/python:3.13`. Assembly needs temporary disk space inside the container as well.

## Editing the video afterwards

Re-export the video, use **Ripple** in the editor to slide the times if you cut dead space (put the playhead where you
cut, enter how many seconds you removed as a negative number such as `-8`, and click **Apply**), and render again.
Nothing is stored in the video, so there is nothing to clean up.

## Project file format

The editor writes version 1 project JSON. Timing-only files are no longer accepted by the editor or render CLI.
The examples in `timings/` are project templates without media; add recordings and save a copy before rendering.

```json
{
  "project_version": 1,
  "output": { "fps": "25/1" },
  "media": [
    { "id": "intro", "path": "media/intro.mp4" },
    { "id": "demo", "path": "media/demo.mp4" }
  ],
  "clips": [
    { "id": "clip-1", "media_id": "intro", "start": 0, "source_in": 0, "source_out": 10 },
    { "id": "clip-2", "media_id": "demo", "start": 12, "source_in": 5, "source_out": 25 }
  ],
  "timing": {
    "schema_version": 2,
    "title": "Demo",
    "product_name": "SUSE",
    "chapters": [
      { "title": "Introduction", "start": 0, "headlines": [[0, "Meet the *product*"]] },
      { "title": "Demonstration", "start": 12, "headlines": [[5, "Start with a *blueprint*"]] }
    ],
    "headlines_end": null,
    "chapters_end": null,
    "wipe_seconds": 0.8
  }
}
```

`media` IDs and clip IDs are unique strings. A source can be referenced by several clips.
Clip duration is `source_out - source_in`; `start` is absolute project time and is authoritative,
regardless of array order. In this example there is a black/silent gap from 10 to 12 seconds and the project ends at 32 seconds.
Source out is exclusive. Overlaps, transitions, invalid references and out-of-source trims fail explicitly.
Output FPS is a positive rational string between 1 and 120 fps, including `30000/1001`.
At render time, clip boundaries use the first output frame at or after their specified time.
Clips that contain no output frames are rejected. Frame-rate quantization can extend the final duration by less than one frame.

The following fields live inside `timing`:

| Key | Meaning |
|---|---|
| `chapters` | At least one chapter object, ordered by `start`. More than six buttons scroll automatically. |
| `chapters[].title` | Chapter/button name; long names are shrunk to fit. |
| `chapters[].start` | Seconds from the start of the video. |
| `chapters[].headlines` | `[chapter-relative seconds, "text"]` rows, or `[]` for no headlines. `*word*` = accent. A row may add a third item, `[start, "text", end]`, to hide the words at that chapter-relative time (it must be after the start); without it a headline stays until the next one starts. Each headline is clipped at its chapter's end. |
| `headlines_end` | Optional absolute cutoff for all headlines, or `null` to use chapter/video boundaries. |
| `chapters_end` | Optional absolute end of the chapter sequence (at least 0.01 seconds), or `null` for automatic end. Caps chapter/headline ranges and MP4 chapter markers without trimming the rendered video. Also defines preview duration when no videos are loaded. |
| `wipe_seconds` | How long each headline takes to wipe in. |
| `product_name` | Text under the logo. |
| `title`, `schema_version` | For your reference and for future format changes. |

Chapter starts are absolute elapsed seconds; headline times are chapter-relative seconds. For example,
the Blueprint headline above appears at `12 + 5 = 17` seconds. Negative offsets or headlines past a chapter
boundary remain editable with warnings but are never rendered. The renderer validates the file before encoding
and reports skipped out-of-chapter headlines explicitly.

The project's nested timing data uses schema 2. The renderer normalizes it in memory without rewriting the project.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Editor says "sample project" | Click **Open file…** and choose your project JSON, or **New** to start a blank one. |
| Preview says "Missing media" | Use **Relink media…** in Videos & settings. Saved placements and trims are retained. |
| Renderer reports missing media | Correct the saved media path relative to the project JSON, or move the source into that location. |
| Clips overlap | Move a clip later or shorten its source range. Crossfades are not supported yet. |
| Editor won't save to the file | Use Chrome or Edge. In other browsers use **Download** and replace the file in `timings/`. |
| `start_editor.command` says port 8765 is in use | Close the earlier editor window, or run `kill $(lsof -ti tcp:8765)` and start it again. |
| A video won't load in the preview | The browser can't play that format. Export an H.264 `.mp4`. |
| A headline is marked **outside chapter** | Move its relative time inside the chapter or extend the chapter. The editor keeps its text but the renderer omits it until corrected. |
| Headlines show at the wrong time | Headline times are relative to their chapter; chapter starts are relative to the start of the video. Check both, and use **Ripple** after cuts. |
| `ffmpeg not found` | Run `pip install -r render/requirements.txt` inside your virtual environment (the renderer uses the ffmpeg that package bundles). |
| Colours look different from the preview | Run `--selftest`; its `colour check` line shows the measured error (expect 4 or less). A larger number means a changed encoder setting. |
| Rendered video is silent | Gaps and clips without audio intentionally produce silence. Check each source with `ffmpeg -i source.mp4`. |
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
`project.js` validates the portable project envelope; `videos.js` manages browser-local media URLs.
The renderer's `project.py` validates the same contract and plans frame-aligned segments; `assemble.py` normalizes
and concatenates those segments before branding. Both runtimes test `tests/fixtures/project.json`.
`TabGroup` renders named slots using reusable `TabPane` panels, with controlled selection, keyboard navigation
and panels kept mounted between switches. Tab IDs must be unique on the page. `ProjectSettings` renders the metadata,
headline settings and ripple forms, emitting actions back to `App.vue` rather than changing the document directly.

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
