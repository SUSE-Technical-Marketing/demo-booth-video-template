# Demo booth video template

Turn a screen recording into a branded booth demo video: a **chapter panel** on the left whose orange button
follows the demo, and a **headline bar** on top where short headlines wipe in from left to right.

It runs inside **DaVinci Resolve** (Fusion page) from a short Python script, and you control every word and every
time in a small **web page** (the timing editor), so changing a headline never means touching code.

![Example of the finished layout](docs/img/finished-layout.png)
> 📷 *Screenshot to add: one finished frame (panel on the left, headline on top, your recording in the slot).*

## How the pieces fit

```
narration ──► LLM prompt ──► headlines ──► timing editor ──► timings/<video>.json ──► Fusion script ──► finished video
 (transcript)  prompts/       (words)       (times, ripple)    (the single source      fusion/             in DaVinci
                                                                of truth)              build_chapter_template.py
```

| Path | What it is |
|---|---|
| `fusion/build_chapter_template.py` | The script you paste into Resolve's Fusion Console. Builds the whole layout. |
| `timings/*.json` | **All the text and timing for one video**: button names, when the orange button switches, every headline. |
| `docs/index.html` | The timing editor (also what GitHub Pages serves). |
| `prompts/headline-prompt.md` | A ready-to-use LLM prompt that turns narration into headlines. |
| `assets/` | SUSE logo (PNG for Fusion) and the SUSE Medium font file used to measure text widths. |
| `start_editor.command` | Double-click to run the editor locally instead of the hosted copy. |

## One-time setup

1. **Clone this repo** to `~/Documents/GitHub/demo-booth-video-template` (the default GitHub Desktop location).
   Somewhere else is fine, but then set `REPO_DIR` at the top of the script (step 4 below).
2. **Install the SUSE font** (Regular, Medium and SemiBold) and **restart Resolve**. It's open source: get it from
   [Google Fonts](https://fonts.google.com/specimen/SUSE) or the [SUSE font repo](https://github.com/SUSE/suse-font).
   Fusion can only use fonts installed on your Mac, which is why the script needs it even though the editor loads
   it from the web.
3. **Use a 1920 × 1080 timeline.** The layout is built in those pixels.

## Make a video, step by step

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
2. At the top, check the **WHERE THINGS ARE** block:
   - `REPO_DIR`: where you cloned this repo.
   - `TIMING_NAME`: which file in `timings/` to build from (for example `my-video.json`).
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

After saving, re-run the script in Resolve.

## Editing the video afterwards

The template belongs to the compound clip. So if you change the video after adding headlines:

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
| Console: `Could not read ... timings/...json` | `REPO_DIR` or `TIMING_NAME` at the top of the script is wrong. |
| Console: `chapter switch ... points to chapter 7` | Chapter numbers go 1 to 6 only. Fix the row in the editor. |
| Text is Times/serif or the wrong font | The SUSE font isn't installed, or Resolve wasn't restarted after installing it. |
| Logo is replaced by the word "SUSE" | `assets/SUSE_Logo-hor_Green.png` wasn't found. Check `REPO_DIR`. |
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
