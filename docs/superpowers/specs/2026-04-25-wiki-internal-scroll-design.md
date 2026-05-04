# Wiki Internal Scroll Design

## Goal

Make the Peiweipedia wiki page scroll inside its own reading surface while keeping the top chrome fixed.

The fixed area is:

- page title / brand copy
- search box
- top tool row (`Article / Talk / Read / 目录 / Comment`)

The scrolling area is:

- article path
- updated timestamp
- article body
- lower wiki modules

## Scope

In scope:

- `web/client/src/pages/wiki/index.ts`
- `web/client/assets/styles/wiki-launch.css`
- focused wiki page tests

Out of scope:

- changing comment drawer behavior
- changing TOC behavior
- changing router behavior
- changing article rendering semantics

## Target Interaction

The wiki page should behave like a reader pane:

1. the page chrome stays visible at the top
2. the content below it scrolls vertically inside the wiki page
3. the outer desktop shell should not need to scroll just to read the article

This means the user can keep the title, search, and tool row visible while reading long pages.

## Layout Model

The main wiki column is split into two vertical regions:

1. `wiki-page__chrome`
2. `wiki-page__body`

`wiki-page__chrome` is fixed within the wiki page layout and contains:

- `wiki-page__header`
- `wiki-page__tabs`

`wiki-page__body` is the internal scroll container and contains:

- `wiki-page__lead`
- `wiki-page__article-layout`
- `wiki-page__modules`

## Structural Rules

- `wiki-page__header` and `wiki-page__tabs` move into a dedicated top chrome wrapper.
- `wiki-page__lead` must stay with the scrollable content, not with the fixed chrome.
- The article path and updated timestamp therefore scroll away with the article.
- The fixed chrome must not overlap the body content; layout must reserve space normally instead of relying on hard-coded body padding hacks.

## Scrolling Rules

- The scrollable region is the wiki page body, not the full browser page.
- The scroll container must support long articles and long lower modules.
- The fixed chrome must remain visible while the body scrolls.
- Existing floating overlays like TOC and comments remain overlays; this change does not redefine them.

## Styling Direction

- Keep the current Peiweipedia visual language.
- Do not redesign the header or tabs.
- Only change layout/overflow behavior needed to create the fixed chrome + internal scroll split.
- Preserve current spacing and borders as much as possible.

## Verification

Verification should prove:

1. long wiki content scrolls inside the wiki page
2. title, search, and tool row remain visible while scrolling
3. article path and updated timestamp scroll with the content
4. comment drawer and TOC still open correctly after the layout change
5. no regression in existing wiki page tests caused by the new internal scroll container
