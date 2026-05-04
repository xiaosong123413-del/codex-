# Flash Diary Visual Image Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to execute task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Turn the flash-diary diary editor into a visual mixed editor that supports drag/drop and paste image insertion at arbitrary body positions, thumbnail display, original-image preview, and Markdown truth-source persistence.

**Architecture:** Keep diary files and save semantics Markdown-first, add one dedicated visual editor controller on the client, add one flash-diary-specific image upload endpoint, and perform orphan asset cleanup during diary save by diffing the old and new Markdown image references for the current diary only.

**Tech Stack:** TypeScript DOM modules, Express routes, Node file helpers, Vitest, existing flash-diary page shell, `rtk`-wrapped verification commands.

---

## File Map

- `web/client/src/pages/flash-diary/index.ts`
  - Switch diary editing from textarea-only wiring to the visual editor controller.
- `web/client/src/pages/flash-diary/view-helpers.ts`
  - Extend refs and diary view helpers for the visual editor surface.
- `web/client/src/pages/flash-diary/visual-editor.ts`
  - Own render, drag/drop, paste, image selection, preview modal, and Markdown serialization.
- `web/server/routes/flash-diary.ts`
  - Add flash-diary image upload and media routes while keeping existing page save contracts.
- `web/server/services/flash-diary-media.ts`
  - Own diary image decode/write/serve helpers and orphan asset cleanup logic.
- `web/server/services/flash-diary.ts`
  - Reuse cleanup helpers during diary save.
- `test/web-flash-diary-page.test.ts`
  - Lock the visual editor UI and image interactions.
- `test/flash-diary-routes.test.ts`
  - Cover upload/media route behavior.
- `test/flash-diary-service.test.ts`
  - Cover Markdown image reference cleanup semantics.
- `docs/project-log.md`
  - Record the user-visible flash-diary editing change.

## Task 1: Lock the New UX with Failing Tests

**Files:**
- Modify: `test/web-flash-diary-page.test.ts`
- Modify: `test/flash-diary-routes.test.ts`
- Modify: `test/flash-diary-service.test.ts`

- [ ] Add a page test that opens a diary item and expects a visual editor shell instead of relying on the textarea as the only diary editing surface.
- [ ] Add a page test that seeds diary Markdown with one image and expects a rendered thumbnail node, not just raw link text.
- [ ] Add a route test for flash-diary image upload that writes a data URL into the target day asset directory and returns a preview URL.
- [ ] Add a service test proving save-time cleanup deletes an orphaned diary asset only when the new Markdown no longer references it.
- [ ] Run the focused test files and verify they fail for the missing behavior.

## Task 2: Add Flash-Diary Image Storage and Cleanup on the Server

**Files:**
- Add: `web/server/services/flash-diary-media.ts`
- Modify: `web/server/services/flash-diary.ts`
- Modify: `web/server/routes/flash-diary.ts`
- Modify: `web/server/index.ts`

- [ ] Implement narrow helpers to:
  - validate flash-diary logical paths
  - derive the diary date asset directory
  - decode accepted image data URLs
  - allocate deterministic non-colliding asset file names
  - serve stored diary images back to the client
- [ ] Update diary save so it compares old vs new diary image references and deletes only truly orphaned files for that diary.
- [ ] Register one upload route and one media route for flash-diary editor images.
- [ ] Re-run focused route/service tests and verify they pass.

## Task 3: Build the Visual Diary Editor

**Files:**
- Add: `web/client/src/pages/flash-diary/visual-editor.ts`
- Modify: `web/client/src/pages/flash-diary/index.ts`
- Modify: `web/client/src/pages/flash-diary/view-helpers.ts`
- Modify: `web/client/styles.css`

- [ ] Replace diary-mode textarea usage with a dedicated visual editor mount point while preserving Memory and twelve-questions behavior.
- [ ] Parse existing diary Markdown into a minimal block model that supports headings, paragraphs, lists, horizontal rules, and image blocks.
- [ ] Render image blocks as selectable thumbnails inside the body flow.
- [ ] Support drag/drop image insertion at the real caret position with multi-image order preserved.
- [ ] Support clipboard image paste at the current caret position.
- [ ] Add original-image preview modal with close button and `Esc` close.
- [ ] Support `Backspace/Delete` removal for a selected image block.
- [ ] Serialize the editor back to Markdown for the existing save endpoint.
- [ ] Re-run page tests and verify they pass.

## Task 4: Finish Verification and Project Log

**Files:**
- Modify: `docs/project-log.md`

- [ ] Update the project log to describe the flash-diary visual mixed editor and image behavior.
- [ ] Run:
  - `rtk test -- npm test -- test/web-flash-diary-page.test.ts test/flash-diary-routes.test.ts test/flash-diary-service.test.ts`
  - `rtk tsc --noEmit`
  - `rtk npm run build`
- [ ] If full-repo verification is still required by repo policy, run:
  - `rtk test -- npm test`
  - `rtk err npx fallow`
- [ ] Report any remaining repo-wide baseline failures separately from this feature.

## Self-Review

- Visual-only diary editing is explicit and raw Markdown is no longer the primary diary surface.
- Save output remains real Markdown.
- Drag/drop and paste rules match the confirmed user behavior.
- Image deletion semantics are scoped to the current diary and only remove the disk file when the last reference disappears.
- No speculative global media manager or compatibility fallback is introduced.
