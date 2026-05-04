# Flash Diary Visual Image Editor Design

## Goal

Replace the flash-diary raw textarea with a true visual mixed editor.

The diary page must let the user:

- drag one or more images directly into the diary body at any position
- paste copied images from the clipboard directly into the diary body
- see inserted images as thumbnails instead of raw Markdown links
- click a thumbnail to open the original image in a preview modal
- close the preview modal with an explicit close button
- delete a selected image block with `Backspace` or `Delete`

The source of truth must remain the real diary Markdown file.

## Confirmed Scope

In scope:

- the flash-diary page right-side diary editor
- drag-and-drop image insertion at the current insertion point
- clipboard image paste at the current insertion point
- multi-image insertion in drop or paste order
- image thumbnail rendering inside the visual diary body
- original image preview modal with close button
- Markdown serialization back to real diary files
- flash-diary image upload and serving routes
- deleting disk image files only when the current diary no longer references them

Out of scope:

- Memory page rendering or editing
- twelve-questions document editing semantics
- wiki article image behavior
- a global media asset manager
- cross-document image deduplication

## Required Behavior

### Visual Editing Model

The flash-diary diary view must no longer expose raw Markdown as the primary editing surface.

The visible editor must behave like a real mixed body:

- text edits happen directly in the document surface
- images sit inline as blocks inside the same body flow
- the user can drag images into any point in the body
- the user can paste clipboard images into any point in the body

The diary page must not require a dedicated drop zone.

### Markdown Truth Source

The stored diary file must remain ordinary Markdown.

Inserted images must serialize to real Markdown image syntax, for example:

```md
![图片 1](./assets/2026-04-27/20260427-101914-01.png)
```

This keeps the diary portable outside the app.

### Insertion Rules

- dragged images insert at the drop caret position
- pasted images insert at the current selection/caret position
- multiple images insert in the exact received order
- if insertion happens inside text, the editor must preserve surrounding text and place the image blocks between the correct text segments

### Display Rules

- inserted images render as thumbnails in the diary body
- thumbnails keep aspect ratio and do not blow out the editor width
- clicking a thumbnail opens an original-image preview modal
- the preview modal must have a visible close button
- the preview modal should also support `Esc` close

### Delete Rules

- when an image block is selected, `Backspace` or `Delete` removes that image block
- deleting one image block must also update the underlying Markdown on save
- the disk image file is deleted only if, after the save result is computed, the current diary no longer contains any reference to that image path
- if the same image file is referenced multiple times in the same diary, deleting only one reference must not delete the disk file

## Storage Design

### Diary File

Diary Markdown files stay under:

- `raw/闪念日记/YYYY-MM-DD.md`

### Diary Image Assets

Diary images live beside the diary system in a per-day asset folder:

- `raw/闪念日记/assets/YYYY-MM-DD/...`

This keeps the image organization aligned with the diary date.

### Upload Boundary

Image upload is diary-specific.

The server must:

- validate that the target path is a flash-diary Markdown file
- decode image payloads from drop/paste uploads
- write the file into the diary asset directory for that day
- return the logical path and a browser URL for immediate preview

## Client Design

### Editor Surface

The diary view should use a dedicated visual editor surface instead of a plain textarea.

The smallest supported structural model is:

- headings
- paragraphs
- horizontal rules
- unordered and ordered lists
- image blocks

This is sufficient for the existing flash-diary content shape while keeping the editor implementation minimal.

### Serialization

The editor must serialize the visible block structure back into Markdown before save.

That save payload must continue using the existing `PUT /api/flash-diary/page` contract:

- `path`
- `raw`

### Preview Modal

The preview modal is client-only state.

It must not alter the stored Markdown.

## Server Design

### New Upload Endpoint

Add a flash-diary-specific upload route for editor images.

It must accept:

- target diary path
- original file name
- image data URL

It must return:

- stored logical path
- preview URL

### Save-Time Cleanup

When saving a diary page:

- compare previously referenced diary asset paths with the newly saved Markdown asset paths
- delete only those asset files that are no longer referenced by the saved diary
- never delete files still referenced by the saved diary

## Files Affected

- `web/client/src/pages/flash-diary/index.ts`
- `web/client/src/pages/flash-diary/view-helpers.ts`
- new flash-diary editor helper modules under `web/client/src/pages/flash-diary/`
- `web/client/styles.css` and/or component styles used by the flash-diary page
- `web/server/routes/flash-diary.ts`
- new flash-diary media helpers under `web/server/services/`
- `test/web-flash-diary-page.test.ts`
- `test/flash-diary-routes.test.ts`
- `test/flash-diary-service.test.ts`

## Verification

Verification must prove:

1. diary view renders a visual editor instead of a raw textarea-only editing experience
2. drag/drop and paste images can insert at the current body position
3. multiple images preserve insertion order
4. thumbnails render inside the diary body
5. clicking a thumbnail opens original-image preview and the preview can be closed
6. save output still writes real Markdown image syntax
7. disk files are removed only when the saved diary no longer references them
