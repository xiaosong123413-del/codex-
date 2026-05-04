# Wiki Comments UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Peiweipedia comments behave like an on-demand reading tool: drawer closed by default, top bar clearly grouped, and new comments created from a selection toolbar instead of from an always-open side panel.

**Architecture:** Keep the current `renderWikiPage()` and `createWikiCommentSurface()` split. Move panel visibility and comment-creation intent into an explicit controller API, then let the wiki page own the floating selection toolbar and top-bar grouping. Preserve the existing comment routes and persistence logic.

**Tech Stack:** TypeScript, DOM APIs, existing Peiweipedia client shell, Vitest with jsdom

---

## File Structure

### Modify

- `web/client/src/components/wiki-comments.ts`
  - Keep comment loading, saving, deleting, and highlighting.
  - Add explicit panel control methods and expose “create from current selection” as a controller action.
- `web/client/src/pages/wiki/index.ts`
  - Restructure the top tool row into clear groups.
  - Add the floating selection toolbar.
  - Wire top-bar `Comment` to drawer toggle only.
- `web/client/assets/styles/wiki-launch.css`
  - Style the grouped top bar.
  - Style the closed/open drawer layout.
  - Style the floating selection toolbar.
- `test/web-wiki-comments.test.ts`
  - Lock default-closed drawer behavior and selection-driven creation flow.
- `test/web-wiki-page.test.ts`
  - Lock top-bar grouping and any page-level rendering changes needed for the new UI.

### Do Not Modify

- `web/server/routes/wiki-comments.ts`
- `web/server/services/wiki-comments.ts`

The backend already supports create / patch / delete, which is sufficient for this UX rewrite.

---

### Task 1: Lock the Drawer-Closed-by-Default Behavior

**Files:**
- Modify: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comments.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comments.test.ts`

- [ ] **Step 1: Write the failing test for the default closed state**

Add a test that loads a wiki page with existing comments, verifies the drawer starts closed, and verifies the existing comments appear only after opening the top-bar `Comment` button.

```ts
it("starts with the comment drawer closed and opens it from the top bar", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/tree?")) {
      return ok({
        name: "wiki",
        path: "wiki",
        kind: "dir",
        children: [
          {
            name: "wiki",
            path: "wiki",
            kind: "dir",
            children: [{ name: "test.md", path: "wiki/concepts/test.md", kind: "file" }],
          },
        ],
      });
    }
    if (url.includes("/api/page?")) {
      return rawOk({
        path: "wiki/concepts/test.md",
        title: "Test",
        html: "<h1>Test</h1><p id=\"wiki-target\">Alpha Beta Gamma</p>",
        raw: "# Test\n\nAlpha Beta Gamma",
        frontmatter: null,
        modifiedAt: "2026-04-24T00:00:00.000Z",
      });
    }
    if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Ftest.md") {
      return ok([
        {
          id: "comment-1",
          path: "wiki/concepts/test.md",
          quote: "Beta",
          text: "共享评论",
          start: 6,
          end: 10,
          resolved: false,
          createdAt: "2026-04-24T00:00:00.000Z",
        },
      ]);
    }
    throw new Error(`unexpected fetch ${url}`);
  }));

  const page = renderWikiPage("wiki/concepts/test.md");
  document.body.appendChild(page);
  await flush();
  await flush();
  await flush();
  await flush();

  const commentsPanel = page.querySelector(".wiki-page__comments") as HTMLElement;
  expect(commentsPanel.hidden).toBe(true);

  page.querySelector<HTMLButtonElement>("[data-wiki-comment-action]")?.click();
  await flush();

  expect(commentsPanel.hidden).toBe(false);
  expect(page.textContent).toContain("共享评论");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk npm test -- test\web-wiki-comments.test.ts`

Expected: FAIL because the current implementation opens the drawer inside `createWikiCommentSurface()` by default.

- [ ] **Step 3: Tighten the existing top-bar test so it no longer expects comment creation**

Replace the current “load + click top-bar comment posts a new comment” expectation with “top-bar comment only opens the drawer.”

```ts
expect(fetchMock.mock.calls.some(([call, options]) =>
  String(call) === "/api/wiki-comments" && options?.method === "POST",
)).toBe(false);
```

- [ ] **Step 4: Run test to verify the assertion still fails for the right reason**

Run: `rtk npm test -- test\web-wiki-comments.test.ts`

Expected: FAIL because the UI still auto-opens the drawer and still routes top-bar `Comment` through draft creation.

- [ ] **Step 5: Commit**

```bash
git add test/web-wiki-comments.test.ts
git commit -m "test: lock default wiki comment drawer behavior"
```

---

### Task 2: Lock the Selection Toolbar Comment-Creation Flow

**Files:**
- Modify: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comments.test.ts`
- Modify: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comments.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`

- [ ] **Step 1: Write the failing selection-toolbar creation test**

Add a test that selects text inside the article, verifies a floating toolbar appears, clicks its `评论` action, and verifies the create-comment POST happens only then.

```ts
it("creates a draft comment from the floating selection toolbar", async () => {
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 120,
      y: 200,
      top: 200,
      left: 120,
      right: 240,
      bottom: 224,
      width: 120,
      height: 24,
      toJSON: () => ({}),
    }),
  });

  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/tree?")) {
      return ok({
        name: "wiki",
        path: "wiki",
        kind: "dir",
        children: [
          {
            name: "wiki",
            path: "wiki",
            kind: "dir",
            children: [{ name: "test.md", path: "wiki/concepts/test.md", kind: "file" }],
          },
        ],
      });
    }
    if (url.includes("/api/page?")) {
      return rawOk({
        path: "wiki/concepts/test.md",
        title: "Test",
        html: "<h1>Test</h1><p id=\"wiki-target\">Alpha Beta Gamma</p>",
        raw: "# Test\n\nAlpha Beta Gamma",
        frontmatter: null,
        modifiedAt: "2026-04-24T00:00:00.000Z",
      });
    }
    if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Ftest.md") {
      return ok([]);
    }
    if (url === "/api/wiki-comments" && init?.method === "POST") {
      return ok({
        id: "comment-2",
        path: "wiki/concepts/test.md",
        quote: "Beta",
        text: "",
        start: 6,
        end: 10,
        resolved: false,
        createdAt: "2026-04-24T00:05:00.000Z",
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }));

  const page = renderWikiPage("wiki/concepts/test.md");
  document.body.appendChild(page);
  await flush();
  await flush();
  await flush();
  await flush();

  const textNode = page.querySelector("#wiki-target")?.firstChild;
  const range = document.createRange();
  range.setStart(textNode!, 6);
  range.setEnd(textNode!, 10);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  await flush();

  const toolbar = page.querySelector<HTMLElement>("[data-wiki-selection-toolbar]");
  expect(toolbar?.hidden).toBe(false);

  page.querySelector<HTMLButtonElement>("[data-wiki-selection-comment]")?.click();
  await flush();

  const commentsPanel = page.querySelector(".wiki-page__comments") as HTMLElement;
  expect(commentsPanel.hidden).toBe(false);
  expect(vi.mocked(fetch).mock.calls.some(([call, options]) =>
    String(call) === "/api/wiki-comments" && options?.method === "POST",
  )).toBe(true);
});
```

- [ ] **Step 2: Write the failing top-bar grouping test**

Add a small page test that asserts the top bar exposes separate page-mode and reading-tool groups.

```ts
it("renders distinct page-mode and reading-tool groups in the top bar", async () => {
  const page = renderWikiPage();
  await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

  expect(page.querySelector("[data-wiki-page-mode-group]")?.textContent).toContain("Article");
  expect(page.querySelector("[data-wiki-page-mode-group]")?.textContent).toContain("Talk");
  expect(page.querySelector("[data-wiki-reading-tools-group]")?.textContent).toContain("Read");
  expect(page.querySelector("[data-wiki-reading-tools-group]")?.textContent).toContain("目录");
  expect(page.querySelector("[data-wiki-reading-tools-group]")?.textContent).toContain("Comment");
});
```

- [ ] **Step 3: Run the tests to verify both fail**

Run: `rtk npm test -- test\web-wiki-comments.test.ts test\web-wiki-page.test.ts`

Expected: FAIL because the current wiki page has no selection toolbar and no split top-bar groups.

- [ ] **Step 4: Keep the toolbar test focused on observable UI**

Do not add test-only hooks. Keep the assertions to:

```ts
expect(toolbar?.hidden).toBe(false);
expect(commentsPanel.hidden).toBe(false);
expect(fetchMock.mock.calls.some(([call, options]) =>
  String(call) === "/api/wiki-comments" && options?.method === "POST",
)).toBe(true);
```

- [ ] **Step 5: Commit**

```bash
git add test/web-wiki-comments.test.ts test/web-wiki-page.test.ts
git commit -m "test: lock wiki selection comment flow"
```

---

### Task 3: Refactor the Wiki Comment Surface Into an Explicit Drawer Controller

**Files:**
- Modify: `D:\Desktop\llm-wiki-compiler-main\web\client\src\components\wiki-comments.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comments.test.ts`

- [ ] **Step 1: Extend the controller interface with explicit drawer actions**

Change the controller interface from:

```ts
export interface WikiCommentSurfaceController {
  setDocument(path: string, html: string): Promise<void>;
  clear(message: string): void;
}
```

to:

```ts
export interface WikiCommentSurfaceController {
  setDocument(path: string, html: string): Promise<void>;
  clear(message: string): void;
  open(): void;
  close(): void;
  toggle(): void;
  createFromSelection(): Promise<void>;
}
```

- [ ] **Step 2: Stop opening the drawer by default**

Replace the eager-open setup:

```ts
setPanelOpen(true);
```

with:

```ts
setPanelOpen(false);
```

and remove the implicit reopen inside `setDocument()`:

```ts
async setDocument(path: string, html: string): Promise<void> {
  currentPath = path;
  baseHtml = html;
  content.innerHTML = html;
  if (!path) {
    comments = [];
    renderComments();
    return;
  }
  await refreshComments();
}
```

- [ ] **Step 3: Rename the selection-creation helper and expose it through the controller**

Replace the private helper:

```ts
async function createCommentFromSelection(): Promise<void> {
  // current logic
}
```

with controller wiring:

```ts
return {
  async setDocument(path: string, html: string): Promise<void> {
    currentPath = path;
    baseHtml = html;
    content.innerHTML = html;
    if (!path) {
      comments = [];
      renderComments();
      return;
    }
    await refreshComments();
  },
  clear(message: string): void {
    currentPath = "";
    baseHtml = "";
    comments = [];
    setPanelOpen(false);
    list.innerHTML = `<p class="wiki-comments-panel__empty">${escapeHtml(emptyLabel)}</p>`;
    status.textContent = message;
  },
  open(): void {
    setPanelOpen(true);
  },
  close(): void {
    setPanelOpen(false);
  },
  toggle(): void {
    setPanelOpen(panel.hidden);
  },
  async createFromSelection(): Promise<void> {
    await createCommentFromSelection();
    setPanelOpen(true);
  },
};
```

- [ ] **Step 4: Remove the old side-button auto-create behavior**

Delete the current add-button click handler:

```ts
addButton.addEventListener("click", () => {
  setPanelOpen(true);
  void createCommentFromSelection();
});
```

and replace it with a drawer-only action:

```ts
addButton.addEventListener("click", () => {
  setPanelOpen(true);
});
```

If the final wiki page markup removes the dedicated drawer add button entirely, also simplify the options type so `addButton` becomes optional and guard the event binding:

```ts
addButton?.addEventListener("click", () => {
  setPanelOpen(true);
});
```

- [ ] **Step 5: Run the focused tests to verify the controller refactor passes**

Run: `rtk npm test -- test\web-wiki-comments.test.ts`

Expected: PASS for the new default-closed and top-bar-toggle assertions, while the selection-toolbar test still fails until the wiki page is wired.

- [ ] **Step 6: Commit**

```bash
git add web/client/src/components/wiki-comments.ts test/web-wiki-comments.test.ts
git commit -m "refactor: make wiki comment drawer explicit"
```

---

### Task 4: Wire the Wiki Page Top Bar and Floating Selection Toolbar

**Files:**
- Modify: `D:\Desktop\llm-wiki-compiler-main\web\client\src\pages\wiki\index.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comments.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`

- [ ] **Step 1: Restructure the top bar into two groups**

Replace the flat tabs markup:

```ts
<nav class="wiki-page__tabs" aria-label="Page tools">
  <a class="is-active" aria-current="page">Article</a>
  <button type="button" class="wiki-page__tab-action" data-wiki-action="talk">Talk</button>
  <span class="wiki-page__tabs-spacer"></span>
  <a class="is-active" aria-current="page">Read</a>
  <button type="button" class="wiki-page__tab-action" data-wiki-toc-toggle aria-pressed="false">目录</button>
  <button type="button" class="wiki-page__tab-action" data-wiki-comment-action>Comment</button>
</nav>
```

with grouped markup:

```ts
<nav class="wiki-page__tabs" aria-label="Page tools">
  <div class="wiki-page__tab-group wiki-page__tab-group--mode" data-wiki-page-mode-group>
    <a class="wiki-page__tab wiki-page__tab--active" aria-current="page">Article</a>
    <button type="button" class="wiki-page__tab" data-wiki-action="talk">Talk</button>
  </div>
  <div class="wiki-page__tab-group wiki-page__tab-group--tools" data-wiki-reading-tools-group>
    <a class="wiki-page__tab wiki-page__tab--active" aria-current="page">Read</a>
    <button type="button" class="wiki-page__tab-action" data-wiki-toc-toggle aria-pressed="false">目录</button>
    <button type="button" class="wiki-page__tab-action" data-wiki-comment-action aria-pressed="false">Comment</button>
  </div>
</nav>
```

- [ ] **Step 2: Add the floating selection toolbar markup**

Insert it next to the article layout so the page owns selection UI:

```ts
<div class="wiki-page__selection-toolbar" data-wiki-selection-toolbar hidden>
  <button type="button" class="wiki-page__selection-action" data-wiki-selection-comment>评论</button>
  <button type="button" class="wiki-page__selection-action" data-wiki-selection-copy>复制</button>
  <button type="button" class="wiki-page__selection-action" data-wiki-selection-cancel>取消</button>
</div>
```

Also add refs:

```ts
selectionToolbar: root.querySelector<HTMLElement>("[data-wiki-selection-toolbar]")!,
selectionComment: root.querySelector<HTMLButtonElement>("[data-wiki-selection-comment]")!,
selectionCopy: root.querySelector<HTMLButtonElement>("[data-wiki-selection-copy]")!,
selectionCancel: root.querySelector<HTMLButtonElement>("[data-wiki-selection-cancel]")!,
```

- [ ] **Step 3: Make the top-bar `Comment` button toggle the drawer only**

Replace:

```ts
refs.commentAction.addEventListener("click", () => {
  refs.commentAdd.click();
});
```

with:

```ts
refs.commentAction.addEventListener("click", () => {
  comments.toggle();
  refs.commentAction.setAttribute(
    "aria-pressed",
    refs.commentPanel.hidden ? "false" : "true",
  );
});
```

- [ ] **Step 4: Add selection tracking and toolbar positioning**

Add a small helper pair near the page-level helpers:

```ts
function bindWikiSelectionToolbar(
  root: DisposableNode,
  refs: ReturnType<typeof getRefs>,
  comments: WikiCommentSurfaceController,
): () => void {
  const hideToolbar = (): void => {
    refs.selectionToolbar.hidden = true;
  };

  const syncToolbar = (): void => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hideToolbar();
      return;
    }
    const range = selection.getRangeAt(0);
    if (!refs.article.contains(range.commonAncestorContainer)) {
      hideToolbar();
      return;
    }
    const quote = selection.toString().trim();
    if (!quote) {
      hideToolbar();
      return;
    }
    const rect = range.getBoundingClientRect();
    refs.selectionToolbar.hidden = false;
    refs.selectionToolbar.style.left = `${rect.left + rect.width / 2}px`;
    refs.selectionToolbar.style.top = `${Math.max(rect.top - 12, 16)}px`;
  };

  const onSelectionChange = (): void => syncToolbar();

  document.addEventListener("selectionchange", onSelectionChange);
  refs.selectionComment.addEventListener("click", () => {
    void comments.createFromSelection();
    hideToolbar();
  });
  refs.selectionCopy.addEventListener("click", async () => {
    const quote = window.getSelection()?.toString().trim() ?? "";
    if (quote && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(quote);
    }
    hideToolbar();
  });
  refs.selectionCancel.addEventListener("click", () => {
    window.getSelection()?.removeAllRanges();
    hideToolbar();
  });

  return () => {
    document.removeEventListener("selectionchange", onSelectionChange);
  };
}
```

Then wire it in `renderWikiPage()`:

```ts
const disposeSelectionToolbar = bindWikiSelectionToolbar(root, refs, comments);

root.__dispose = () => {
  controller.abort();
  disposeToc();
  disposeSelectionToolbar();
  clearWikiPageTimers(root);
};
```

- [ ] **Step 5: Run the page-level tests**

Run: `rtk npm test -- test\web-wiki-comments.test.ts test\web-wiki-page.test.ts`

Expected: PASS for the new grouped top bar and selection-toolbar comment flow.

- [ ] **Step 6: Commit**

```bash
git add web/client/src/pages/wiki/index.ts test/web-wiki-comments.test.ts test/web-wiki-page.test.ts
git commit -m "feat: add selection-driven wiki comment flow"
```

---

### Task 5: Apply the Visual Separation and Drawer/Toolbar Styling

**Files:**
- Modify: `D:\Desktop\llm-wiki-compiler-main\web\client\assets\styles\wiki-launch.css`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`

- [ ] **Step 1: Replace the flat tabs styling with grouped controls**

Replace the old `wiki-page__tabs` rules:

```css
.wiki-page__tabs {
  display: grid;
  grid-template-columns: auto auto 1fr auto auto auto;
  align-items: end;
  margin-top: 12px;
  border-bottom: 1px solid #a2a9b1;
}
```

with grouped layout:

```css
.wiki-page__tabs {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-top: 12px;
  padding-bottom: 2px;
  border-bottom: 1px solid #a2a9b1;
}

.wiki-page__tab-group {
  display: inline-flex;
  align-items: flex-end;
  gap: 8px;
}

.wiki-page__tab-group--mode {
  padding-right: 20px;
  border-right: 1px solid #c8ccd1;
}

.wiki-page__tab,
.wiki-page__tab-action {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid #a2a9b1;
  background: #f8f9fa;
  color: #202122;
  font-size: 15px;
}

.wiki-page__tab--active {
  background: #ffffff;
  border-bottom-color: #ffffff;
  margin-bottom: -1px;
}
```

- [ ] **Step 2: Keep the article full-width when the drawer is closed**

Keep the current grid rule, but make the drawer state visually intentional:

```css
.wiki-page__article-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 0;
  align-items: start;
  margin-top: 16px;
}

.wiki-page__article-layout[data-wiki-comments-open="false"] {
  grid-template-columns: minmax(0, 1fr);
}

.wiki-page__comments[hidden] {
  display: none;
}
```

- [ ] **Step 3: Add the floating selection-toolbar styling**

Add:

```css
.wiki-page__selection-toolbar {
  position: fixed;
  z-index: 40;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border: 1px solid #a2a9b1;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 14px 40px rgba(60, 72, 88, 0.18);
  transform: translate(-50%, -100%);
}

.wiki-page__selection-toolbar[hidden] {
  display: none;
}

.wiki-page__selection-action {
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid #c8ccd1;
  background: #f8f9fa;
  color: #202122;
  font-size: 13px;
}
```

- [ ] **Step 4: Run the focused tests and the related wiki suite**

Run:

```bash
rtk npm test -- test\web-wiki-comments.test.ts test\web-wiki-page.test.ts test\web-router.test.ts
```

Expected: PASS

- [ ] **Step 5: Run the broader regression and builds**

Run:

```bash
rtk npm test -- test\web-page-cache.test.ts test\web-router.test.ts test\web-wiki-page.test.ts test\web-chat-links.test.ts test\web-page-access-retention.test.ts test\web-wiki-comments.test.ts test\webui-desktop-integration.test.ts
rtk npm run web:build
rtk npm run build
```

Expected:

- all targeted tests PASS
- `web:build` succeeds
- root `build` succeeds

- [ ] **Step 6: Commit**

```bash
git add web/client/assets/styles/wiki-launch.css test/web-wiki-page.test.ts
git commit -m "style: clarify farzapedia comment controls"
```

---

## Spec Coverage Check

- default drawer closed: covered by Task 1 and Task 3
- top bar clear grouping: covered by Task 2, Task 4, and Task 5
- selection-triggered floating toolbar: covered by Task 2 and Task 4
- save/delete preserved in drawer: preserved explicitly in Task 3 and verified in Task 5 regression

## Placeholder Scan

- no TBD/TODO markers
- every task names exact files
- every test step includes an actual command
- every code step includes concrete code snippets

## Type Consistency Check

- controller methods are named consistently as `open`, `close`, `toggle`, `createFromSelection`
- page-level code uses the same controller names
- test selectors align with the planned markup names:
  - `data-wiki-page-mode-group`
  - `data-wiki-reading-tools-group`
  - `data-wiki-selection-toolbar`
  - `data-wiki-selection-comment`

