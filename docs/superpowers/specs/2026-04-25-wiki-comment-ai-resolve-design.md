# Wiki Comment AI Resolve Design

## Goal

Add an `AI自动解决` action to Peiweipedia wiki comments so that a comment can drive an AI-generated page edit proposal.

The workflow is strict:

1. user writes a normal wiki comment
2. user clicks `AI自动解决`
3. the system generates a proposed page modification
4. the user reviews only a diff
5. after confirmation, the system writes the change back to the Obsidian source page
6. the comment is automatically marked as resolved
7. the current wiki page refreshes and shows the updated content

This feature exists to close the loop between comment feedback and source content maintenance without turning runtime wiki pages into editable truth.

## Confirmed Scope

In scope:

- Peiweipedia wiki comment cards in `web/client/src/components/wiki-comments.ts`
- wiki page comment orchestration in `web/client/src/pages/wiki/index.ts`
- new wiki comment AI draft backend routes under `web/server/routes/`
- new wiki comment AI draft service/storage under `web/server/services/`
- diff-only review UI for a single comment
- writing confirmed changes back to the Obsidian source vault page
- automatically resolving the comment and refreshing the current wiki page after successful write

Out of scope:

- editing runtime-only generated pages
- full-page preview review
- background job queues or multi-comment batch solve
- changing the existing manual comment save/delete flow
- replacing the current sync-compile model

## Source-of-Truth Rule

This feature writes only to the editable Obsidian source vault.

For normal wiki pages, the editable target is the markdown file under:

- `D:\Desktop\ai的仓库\wiki\...`

The runtime root remains storage for:

- comment records
- AI draft records
- taxonomy and search indexes
- generated wiki-only pages such as runtime `wiki/index.md` and runtime `wiki/MOC.md`

`AI自动解决` must not write to runtime-generated content.

## Editable Page Rule

`AI自动解决` is available only when the current page maps to a real editable source markdown file.

The button is not available for:

- runtime virtual wiki pages such as generated `wiki/index.md`
- generated `wiki/MOC.md`
- any page resolved only from runtime storage without a source-vault markdown target

This keeps the feature aligned with the user's requirement that Obsidian content remains the true source.

## Final Interaction Model

Each unresolved comment card keeps the existing actions and gains one more action:

- `保存`
- `解决`
- `AI自动解决`
- `删除`

`AI自动解决` is shown only when all of these are true:

- the page is source-editable
- the comment is still unresolved
- the comment text is not empty after trimming

The `AI自动解决` flow has four visible states:

1. idle
2. generating draft
3. review diff
4. write confirmed

### Idle

The comment behaves like it does today, except the card includes `AI自动解决`.

### Generating Draft

When the user clicks `AI自动解决`:

- the button becomes disabled for that card
- the card shows a generating status
- duplicate clicks are blocked
- any previous unfinished AI draft for the same comment is replaced

### Review Diff

When the draft is ready:

- the card switches into review mode
- the comment card shows only the diff result for that draft
- the available actions become:
  - `确认写回`
  - `放弃草案`

No full-page preview is shown.

### Write Confirmed

When the user clicks `确认写回`:

- the confirmed content is written to the source vault page
- the comment is automatically marked resolved
- the draft is deleted
- the current wiki page reloads
- the comment panel refreshes

When the user clicks `放弃草案`:

- the draft is deleted
- the comment remains unresolved
- the card returns to the normal comment state

## AI Draft Model

An AI draft is a temporary object attached to a comment workflow, but it is not the comment itself.

This separation is required because:

- the comment is durable user feedback
- the AI draft is a disposable proposed edit
- the user may generate, discard, and regenerate drafts without mutating the original comment text

Each draft stores:

- `id`
- `commentId`
- `pagePath`
- `sourceFile`
- `baseVersion`
- `status`
- `promptSummary`
- `proposedContent`
- `diffText`
- `createdAt`
- `updatedAt`
- `errorMessage`

`baseVersion` must be derived from the source file at draft-generation time so confirmation can detect whether the source file changed before write-back.

## AI Input Contract

The AI generation step uses the full source page, not just the selected quote.

The prompt input must include:

- current comment text
- quoted selection from the comment
- page logical path
- full source markdown for the page

AI draft generation is not allowed for an empty comment body.

The AI is allowed to produce a whole-page updated markdown result, because the user explicitly approved whole-page coordinated edits.

The review surface still shows only a diff.

## Diff Review Rule

The review layer is diff-only.

The backend generates a candidate full markdown result, then computes a textual diff between:

- current source markdown
- candidate source markdown

The frontend renders only this diff in the comment card review state.

The user never sees a separate full-page preview in this workflow.

## Backend API Shape

Keep existing manual comment CRUD routes unchanged.

Add three dedicated routes for AI resolve:

- `POST /api/wiki-comments/:id/ai-draft`
  - generates or replaces the active AI draft for a comment
  - returns draft metadata plus diff text
  - rejects empty comment text

- `POST /api/wiki-comments/:id/ai-draft/:draftId/confirm`
  - verifies the source file is unchanged from the stored base version
  - writes the proposed content to the source vault page
  - marks the comment resolved
  - deletes the draft
  - returns the refreshed page payload

- `DELETE /api/wiki-comments/:id/ai-draft/:draftId`
  - discards the current draft
  - does not modify the source file
  - does not resolve the comment

This keeps AI-assisted editing as a separate workflow instead of overloading the existing comment update route.

## Backend Service Boundaries

Split responsibilities into focused units:

- comment storage service
  - keeps existing comment CRUD behavior

- comment AI draft service
  - validates page editability
  - reads source markdown
  - generates candidate updated markdown
  - computes diff text
  - stores draft metadata in runtime
  - confirms or discards drafts

- source page writer
  - writes confirmed content back to `sourceVaultRoot`
  - performs source-version validation before write

The current `wiki-comments` storage service should not be stretched to own full AI draft logic.

## Storage Rule

Comment records remain in runtime storage.

AI drafts also live in runtime storage, beside other machine-maintained state, for example under:

- `runtimeRoot/.llmwiki/wiki-comment-ai-drafts.json`

Confirmed edits must not be stored as runtime shadow copies.

The only durable page write is the confirmed write to the source vault markdown file.

## Confirmation Rule

Confirmation is allowed only if all of these are true:

- the draft exists
- the draft belongs to the current comment
- the target source file still exists
- the source file version still matches `baseVersion`

If any check fails, confirmation must be rejected without writing.

After successful confirmation:

- source file content is updated
- the comment is set to `resolved: true`
- the AI draft is removed

## Failure Handling

Failure behavior is strict.

### Non-editable page

If the page is not source-editable:

- `AI自动解决` is hidden or unavailable
- the server rejects generation requests for that page

### AI generation failure

If AI draft generation fails:

- no file write happens
- the comment remains unresolved
- no confirm action is shown
- the card shows a retryable error state

### Draft stale because source changed

If the source file changed after the draft was generated:

- confirm is rejected
- no write happens
- the draft remains reviewable or regeneratable
- the user is told to regenerate the draft

### Write failure

If source file write fails:

- no partial comment resolution happens
- the comment remains unresolved
- the draft remains available
- the page is not refreshed as success

## Frontend Behavior Rules

The comment card owns the feature.

The new button does not appear in the top toolbar or page header.

The card must display per-comment busy state so one comment draft operation does not freeze the entire panel.

The refresh behavior after successful confirm is:

1. refresh the current page payload
2. rerender the article html
3. refresh the comment list
4. show the resolved state for the confirmed comment

The UI must not silently resolve the comment before the write succeeds.

## Reuse Rule

Reuse the existing “draft then confirm write” architectural pattern already present in the codebase for deep-research style flows.

Do not introduce a queue, worker system, or broad task framework for this feature.

This is a synchronous per-comment interaction on the wiki page.

## Verification

Verification must cover three layers.

### Service Tests

- generating an AI draft from a valid editable wiki comment returns a stored draft and diff text
- confirming a valid draft writes to the source vault markdown file
- confirming a valid draft automatically resolves the comment
- discarding a draft deletes only the draft
- source-version mismatch rejects confirmation
- non-editable pages reject AI draft generation

### Route Tests

- `POST /api/wiki-comments/:id/ai-draft`
- `POST /api/wiki-comments/:id/ai-draft/:draftId/confirm`
- `DELETE /api/wiki-comments/:id/ai-draft/:draftId`

### Frontend Tests

- comment cards render `AI自动解决` for editable pages
- clicking `AI自动解决` shows a generating state
- generated drafts render a diff-only review state
- `确认写回` resolves the comment and refreshes the page
- `放弃草案` clears the draft and restores the normal comment state
- runtime-only wiki pages do not offer `AI自动解决`
