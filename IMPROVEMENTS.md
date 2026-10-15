# Application improvement roadmap

Status: proposed backlog, not a description of shipped features.
Created: 2026-10-15.

This document turns the application review into work items that can be implemented
and verified independently. Check the current behavior before starting each item:
the observations below describe the code at the time of review.

## Goals and boundaries

- Make it harder to lose edits or overwrite the wrong file.
- Help authors find timing and readability problems before rendering.
- Make precise and repetitive editing faster.
- Keep the preview, timing JSON, Python renderer and Fusion integration consistent.
- Keep the editor browser-local, statically hosted and usable without a backend.
- Keep this a timing and branding tool, not a replacement for a video editor.

Preserve these behaviors unless a work item explicitly proposes and approves a change:

- Headlines belong to chapters and cannot render beyond their effective boundaries.
- Editing selection and playback position are distinct; Follow playhead is optional.
- Switching sidebar tabs preserves drafts, selection and loaded videos.
- Preview clips remain local. Do not upload media or embed it in timing JSON.
- The portable timing document remains compatible with both rendering paths.
- A configured chapter end does not trim loaded or rendered video.
- Browsers without file-system pickers retain import and download workflows.

## Priorities and effort

P1 means editing safety or preventing incorrect output. P2 means workflow or
maintainability improvements. Effort is relative, not a delivery commitment:
S is a focused change, M crosses several surfaces, and L needs a new workflow or format.

Items start as **Proposed**. Move them through **Ready**, **In progress**,
**Partially delivered** and **Done** as decisions are resolved and acceptance criteria are verified.

| ID | Work item | Priority | Effort | Status |
|---|---|---|---|---|
| IMP-01 | Safe document switching, history and external-file conflicts | P1 | M | Proposed |
| IMP-02 | Recoverable local drafts | P1 | M | Proposed |
| IMP-03 | Consolidated project checks | P1 | M | Proposed |
| IMP-04 | Consistent timing precision and timeline snapping | P2 | S-M | Proposed |
| IMP-05 | Reopenable preview projects and clearer render handoff | P2 | M-L | Partially delivered |
| IMP-06 | Faster content editing and range preview | P2 | M | Proposed |
| IMP-07 | Extract behavioral boundaries from the app | P2 | M | Proposed |
| IMP-08 | Stronger data contracts and cross-runtime timing fixtures | P2 | M | Proposed |
| IMP-09 | Real-browser regression tests and media reliability | P2 | M | Proposed |

## IMP-01: Safe document switching, history and external-file conflicts

**Why:** New prompts about unsaved changes, but Open/import do not use the same
guard. History stores document snapshots separately from file identity and survives
document loads. Refresh avoids replacing dirty edits, but saving does not check
whether the linked file changed externally.

**Scope**

- Use a consistent Save / Discard / Cancel flow before replacing dirty documents.
- Associate history with the correct document and file binding.
- Add redo with explicit edit transactions: one drag or editing session should
  produce one understandable history operation.
- Compare the linked file against the last known disk version before overwriting
  it. Offer explicit conflict resolution instead of silently choosing a winner.

**Acceptance criteria**

- Cancel, denied permission or a failed save leaves the current document intact.
- Undo cannot silently restore another document's content under the wrong file handle.
- Undo/redo behaves consistently for typing, nudging, timeline dragging and ripple.
- An external change while local edits are dirty produces a conflict warning.
- Save as remains available to preserve local edits without replacing the external file.
- Tests cover document switching and asynchronous save/load races.

**Decisions before implementation:** Clear history on document changes or retain
separate document histories? How should undoing New restore the previous document
and its file binding? Keep existing behavior unless a change is explicitly agreed.
Browser-side conflict checks are best effort, not atomic multi-user locking.

**Starting points:** [App.vue](editor/src/App.vue),
[fileAccess.js](editor/src/fileAccess.js), [App.test.js](editor/src/App.test.js).

## IMP-02: Recoverable local drafts

**Why:** Linked-file autosave does not protect every workflow. IndexedDB currently
remembers a file handle, not a recovery copy of the document.

**Scope:** Store a debounced recovery snapshot independently of linked-file saving,
including document identity, recovery format version and modification time.

**Acceptance criteria**

- A reload or browser restart can offer Restore recovered draft / Discard.
- Recovery works for imported files and new documents without linked handles.
- Restoring a draft does not automatically overwrite the linked file.
- Successful saves and explicit discards update or retire recovery records predictably.
- Storage failures are visible, and editing/export remain usable.
- Users can clear recovery data; explain that draft text is stored locally.

**Decisions before implementation:** One recent draft or several projects? What
retention policy applies? Coordinate document identity and discard behavior with IMP-01.
Preview media recovery belongs to IMP-05, not this item.

## IMP-03: Consolidated project checks

**Why:** Existing warnings are distributed across rows, badges and preview statistics.
Authors need a single place to assess whether a video is ready to render.

**Scope:** Build a pure diagnostic collector and a navigable issues panel. Initial
checks should cover out-of-range headlines, duplicate chapter starts, zero-length
chapters, insufficient reading time, small fitted text, missing video coverage and
overlapping preview clips.

**Acceptance criteria**

- Each issue has a stable code, severity, explanation and target chapter/headline.
- Selecting an issue opens the correct tab and editing context.
- Diagnostics update after edits, undo, imports and changes to preview clips.
- Errors and advisories are distinct; intentional gaps are not automatically errors.
- Readability considers visible duration after the wipe, not only total cue duration.
- The panel does not block saving valid work-in-progress documents.

**Decisions before implementation:** Minimum text sizes and reading-time thresholds;
which conditions are errors versus advisories. Measure text thresholds in output
pixels, not the size of the browser preview.

**Starting points:** [timing.js](editor/src/timing.js),
[ChapterEditor.vue](editor/src/components/ChapterEditor.vue),
[DurationBadge.vue](editor/src/components/DurationBadge.vue).

## IMP-04: Consistent timing precision and timeline snapping

**Why:** Editing and serialization use different rounding increments. A focused
runtime check found that `fmt(59.96)` displays `0:60` and `fmt(119.96)` displays `1:60`.
The timeline already supports fixed-step handles; snapping would complement them.

**Suggested slices**

1. Fix minute-boundary formatting and add regression tests.
2. Define the supported timing precision and round-trip rules.
3. Add optional snapping to neighboring boundaries and the playhead.
4. Consider frame-rate-aware display and nudging if needed for the actual workflow.

**Acceptance criteria**

- Displayed times carry correctly across minute/hour boundaries.
- Supported values round-trip without unexplained drift.
- Absolute timecode, elapsed time and chapter-relative time remain distinguishable.
- Snapping has a visible target and a documented bypass modifier.
- Editing still respects chapter/headline boundaries and explicit ends.
- If frame-based editing is added, test fractional frame rates and renderer parity.

**Decisions before implementation:** Seconds versus frame-based editing; supported
frame rates; rounding policy; snapping tolerance. Do not imply that the existing
`h:mm:ss` input already supports frame numbers or drop-frame timecode.

**Starting points:** [timing.js](editor/src/timing.js),
[TimeInput.vue](editor/src/components/TimeInput.vue),
[Timeline.vue](editor/src/components/Timeline.vue).

## IMP-05: Reopenable preview projects and clearer render handoff

**Delivered foundation:** Version 1 project JSON now persists media references,
clip placements, source trims, output FPS and nested chapter/headline timing.
The browser can relink missing sources, and the renderer assembles multiple clips,
black/silent gaps and hard cuts. Timing-only files are no longer the public format.
Crossfades remain deferred.

**Suggested slices**

1. Add a Prepare for rendering view with project checks, project export and a
   copyable render command.
2. Extend relinking with a folder-based workflow if individual file selection is cumbersome.
3. Consider remembering browser file handles locally to reduce relinking between visits.

**Acceptance criteria**

- Explain the shared preview/render project model and its hard-cut-only limitation.
- Keep browser-only URLs and permissions outside portable project JSON.
- Reopening restores supported clip placements or clearly requests relinking.
- Missing media does not prevent editing timing/text or exporting timing JSON.
- Command generation handles spaces and quoting for the supported shell.
- No media is uploaded or embedded in project metadata.

**Remaining decisions:** Supported browsers and local file-handle retention.
Multi-clip rendering is implemented; an in-browser encoder and crossfades remain separate work.

**Starting points:** [videos.js](editor/src/videos.js),
[VideoList.vue](editor/src/components/VideoList.vue),
[render instructions](README.md#render-the-finished-video).

## IMP-06: Faster content editing and range preview

**Why:** Repeated text entry and repeated playback navigation slow down authoring.
Ship these as separate small features rather than one large editing-mode change.

**Candidate slices**

- Paste several lines as separate headlines.
- Duplicate a headline or an independent chapter with its own headline copies.
- Search chapter titles and headline text.
- Move a headline between chapters, explicitly preserving relative or absolute time.
- Loop playback over a selected chapter or time range.

**Acceptance criteria**

- Each operation has predictable timing placement and an undoable transaction.
- Copies receive new identities; duplication never reintroduces shared chapter reuse.
- Bulk paste previews or explains placement and any resulting boundary warnings.
- Moving a headline never silently changes ownership through sorting alone.
- Range preview is a view setting and does not change saved document/video boundaries.
- Search reveals the matching editing context without modifying document data.

**Decisions before implementation:** Choose the first slice based on authoring pain;
define timing placement for duplication/paste and default behavior for cross-chapter moves.

## IMP-07: Extract behavioral boundaries from the app

**Why:** UI components are now reasonably separated, but the app still coordinates
history, mutations, selection, playback, file access and autosave.

**Suggested boundaries**

- `useDocumentHistory`: edit transactions, undo/redo and document boundaries.
- `useLinkedDocument`: open/save/reconnect, conflict checks and recovery coordination.
- `usePlayback`: playhead, animation lifecycle, seeking and range playback.
- Pure document operations where invariants must be shared by fields, drag handles
  and ripple actions.

**Acceptance criteria**

- Each extraction has a small API and explicit ownership of reactive state.
- Components emit intentions; mutations and validation remain traceable.
- Timers, animation callbacks and event listeners are cleaned up by their owner.
- Tests verify existing behavior before and after extraction.
- Avoid introducing a global store merely to reduce the size of the app file.

**Sequencing:** Extract alongside IMP-01, IMP-02 and range preview, rather than
performing a large architectural rewrite first.

**Starting point:** [App.vue](editor/src/App.vue).

## IMP-08: Stronger data contracts and cross-runtime timing fixtures

**Why:** Broad `Object`/`Array` component props and DOM-event-based settings callbacks
leave contracts implicit. JavaScript and Python independently interpret timing data.

**Scope:** Add incremental JSDoc types or TypeScript for the core document and action
contracts. Use shared fixture documents with expected timing outcomes in both runtimes.

**Acceptance criteria**

- Document, chapter, headline and clip shapes are explicit and checked.
- New component events carry domain values rather than requiring parents to inspect DOM targets.
- Shared fixtures cover legacy migration, ownership, empty chapters, explicit ends,
  gaps, fractional times and exact boundary activation.
- Both runtimes verify expected outcomes, not just that fixtures parse.
- Renderer and Fusion behavior remain covered without requiring Resolve in CI.
- Format changes remain backward compatible or have an explicit migration plan.

**Decisions before implementation:** JSDoc versus incremental TypeScript; fixture
format and ownership. Do not assume schema generation or a full language migration
is necessary.

**Starting points:** [timing.js](editor/src/timing.js),
[ProjectSettings.vue](editor/src/components/ProjectSettings.vue),
[shared renderer timing](render/timing.py), [tests](tests/).

## IMP-09: Real-browser regression tests and media reliability

**Why:** Component tests use jsdom. They cannot fully verify layout, native focus,
pointer capture or media playback. The preview currently suppresses rejected
`play()` promises without user feedback.

**Scope:** Add a small real-browser smoke suite and improve media lifecycle/error handling.

**Acceptance criteria**

- Cover native keyboard tab navigation and timeline handle dragging.
- Check narrow sidebar/mobile layouts for overlap and inaccessible controls.
- Verify switching tabs preserves video elements and editing context.
- Test seek/play synchronization with a small generated local clip.
- Playback failures produce actionable feedback rather than a misleading playing state.
- Video loads, object URLs and playback resources are cleaned up on removal,
  document reset and unmount, including failed or interrupted loads.
- Smoke-test import/download fallback; retain mocks for privileged file-picker behavior.
- Run the bounded browser suite in CI without external media dependencies.

**Decisions before implementation:** Browser test framework and initial browser matrix.
Keep broad browser coverage separate from the first reliable smoke suite.

**Starting points:** [Preview.vue](editor/src/components/Preview.vue),
[videos.js](editor/src/videos.js), [test configuration](vite.config.js),
[CI workflow](.github/workflows/test.yml).

## Suggested delivery order

1. **Editing safety:** IMP-01, then IMP-02 using the agreed document identity model.
   Extract the relevant behavioral boundaries from IMP-07 as part of this work.
2. **Confidence before rendering:** IMP-03 and the small formatting fix from IMP-04.
   Start shared parity fixtures from IMP-08 as timing changes are made.
3. **Authoring speed:** Select one slice from IMP-06, then add snapping or precision
   features from IMP-04 according to user feedback.
4. **Project continuity:** Ship the render-handoff slice of IMP-05 before deciding
   on a larger editor-project format.

IMP-09 can start independently; use its smoke tests to protect later workflow changes.
This sequence is guidance, not a requirement to finish every item before shipping.

## Definition of done

- Relevant open decisions are resolved and recorded in the work item or pull request.
- Acceptance criteria are verified, with regression coverage for changed behavior.
- Existing file formats and intentional editing behavior are preserved or migrated explicitly.
- Run focused editor tests and a production build for editor changes.
- Run renderer/Fusion tests when timing or interchange semantics change.
- Verify layout, focus and pointer behavior in a real browser when UI behavior changes.
- Update related user/developer documentation.
- Mark the item Done with a completion reference; keep deferred slices and decisions visible.
