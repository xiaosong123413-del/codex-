# Wiki Comments UX Design

## Goal

Rewrite only the Peiweipedia wiki page comment interaction so that comments behave like an intentional reading tool instead of a permanently open side panel.

The target is a desktop-first reading flow where:

- the article stays primary by default
- comments are opened only on demand
- creating a comment starts from selected text
- editing happens in a dedicated right-side drawer

## Confirmed Scope

In scope:

- the Peiweipedia wiki page in `web/client/src/pages/wiki/`
- the wiki comment surface in `web/client/src/components/wiki-comments.ts`
- related wiki page styling in `web/client/assets/styles/wiki-launch.css`
- focused tests for wiki page and wiki comments behavior

Out of scope:

- changing wiki comment backend routes or storage format
- redesigning the chat page
- redesigning the whole Peiweipedia shell
- changing article rendering semantics outside comment UX

## Final Interaction Model

The wiki page has three distinct comment states:

1. default reading state
2. selection state
3. comment drawer state

The article is primary in the default state.

The comment drawer is closed by default and does not occupy the right side until the user explicitly opens it.

## Top Bar Structure

The top tool row is split into two explicit groups.

### Left Group: Page Mode

- `Article`
- `Talk`

These are page-mode tabs.

Rules:

- `Article` is the active reading tab
- `Talk` remains available as a route/action
- these controls look like tabs, not utility buttons

### Right Group: Reading Tools

- `Read`
- `目录`
- `Comment`

These are reading utilities.

Rules:

- this group is visually separated from the page-mode group
- `Read` shows active reading state
- `目录` and `Comment` are utility toggles/buttons
- the current implementation where all labels blend together is removed

## Default Reading State

When a wiki page loads:

- the right comment drawer is closed
- the article spans the full main content width
- no empty comment panel is shown by default
- the `Comment` top-bar button is available but does not create a comment by itself

## Selection Interaction

Selecting text inside the article triggers a small floating action toolbar next to the selection.

The floating toolbar contains:

- `评论`
- `复制`
- `取消`

Rules:

- the floating toolbar appears only when the text selection is valid and inside the article body
- it does not appear for collapsed selection
- it disappears when selection is cleared, cancelled, or after starting comment creation
- it is an in-context action launcher, not the full editor

## Comment Creation Flow

The comment creation flow is strict:

1. user selects article text
2. floating toolbar appears near the selection
3. user clicks `评论`
4. the right comment drawer opens
5. a draft comment is created for that selected quote
6. the draft becomes editable in the drawer

Rules:

- top-bar `Comment` only opens/closes the drawer
- top-bar `Comment` does not create an empty comment
- comment creation always begins from selected text

## Comment Drawer

The right drawer is the editing surface.

It contains:

- quoted source text
- editable comment input
- `保存`
- `删除`
- existing comment cards for the current page

Rules:

- opening the drawer without a current selection is allowed for review/browsing existing comments
- creating a new comment from selection should focus the active draft in the drawer
- `保存` persists the current comment text
- `删除` removes the current draft or existing comment
- the drawer can be closed independently without losing the article context

## Layout Rules

Default layout:

- article uses the full content width when comments are closed
- comment drawer takes the right column only when open

This means the current always-open split layout is removed.

## Styling Rules

The top bar must visually distinguish the two groups.

Required outcome:

- `Article / Talk` read as page tabs
- `Read / 目录 / Comment` read as tool controls
- there is visible spacing and grouping between the two clusters
- the active state is obvious at a glance

The floating toolbar should look lightweight and contextual:

- compact
- anchored near the selection
- visually above article content
- clearly temporary

## Reuse Rules

Keep existing backend and existing comment persistence behavior.

Reuse existing save/delete/update comment logic where possible.

Do not rewrite the comment data model just to support the new UI.

## Implementation Strategy

Keep the change surgical:

- update wiki page markup so the comment drawer starts closed
- separate top bar controls into two distinct visual groups
- add a selection-based floating action toolbar for article text
- change comment creation trigger from “always use the side button” to “selection first”
- preserve current save/delete patch/delete API calls

## Verification

Verification should prove:

1. wiki page loads with the comment drawer closed
2. clicking top-bar `Comment` opens and closes the drawer without creating a comment
3. selecting article text shows the floating toolbar
4. clicking floating-toolbar `评论` opens the drawer and starts a draft comment for the selected quote
5. drawer comments can still save and delete correctly
6. the top bar visually separates page tabs from reading tools
