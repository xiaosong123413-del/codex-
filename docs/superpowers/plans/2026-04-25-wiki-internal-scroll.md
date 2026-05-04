# Wiki Internal Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Peiweipedia wiki page scroll inside its own content region while keeping the title, search, and tool row fixed at the top of the wiki pane.

**Architecture:** Split the wiki main column into a fixed chrome wrapper and a scrollable body wrapper. Keep the existing header and tab markup semantics, but move them into a dedicated `wiki-page__chrome` container and put the lead/article/modules inside a dedicated `wiki-page__body` scroll container. Verify the new layout with focused page tests plus a small regression pass.

**Tech Stack:** TypeScript, DOM rendering, CSS layout/overflow, Vitest with jsdom

---

## File Structure

### Modify

- `D:\Desktop\llm-wiki-compiler-main\web\client\src\pages\wiki\index.ts`
  - Add the `wiki-page__chrome` and `wiki-page__body` wrappers in the rendered markup.
  - Keep title/search/tool row inside chrome.
  - Keep path/meta/article/modules inside body.
- `D:\Desktop\llm-wiki-compiler-main\web\client\assets\styles\wiki-launch.css`
  - Turn `wiki-page__main` into a two-row layout.
  - Make `wiki-page__body` the internal vertical scroll container.
  - Keep spacing and visual language stable.
- `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`
  - Add focused tests for the new chrome/body split.
  - Assert the lead stays in the scrollable body and does not move into chrome.
  - Assert the internal scroll container receives the expected overflow rules.

### Do Not Modify

- `D:\Desktop\llm-wiki-compiler-main\web\client\src\components\wiki-comments.ts`
- `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comments.test.ts`

This change is layout-only. Comment behavior was already stabilized and should not be touched unless a regression forces it.

---

### Task 1: Lock the Internal Scroll Layout Contract in Tests

**Files:**
- Modify: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`

- [ ] **Step 1: Add the failing structure test for fixed chrome vs scroll body**

Add a page-level test that verifies the wiki page renders separate chrome/body wrappers and that the expected elements land in the correct wrapper.

```ts
it("renders fixed chrome and scrollable body regions for the wiki page", async () => {
  const page = renderWikiPage();
  await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

  const chrome = page.querySelector<HTMLElement>("[data-wiki-chrome]");
  const body = page.querySelector<HTMLElement>("[data-wiki-body]");

  expect(chrome).toBeTruthy();
  expect(body).toBeTruthy();
  expect(chrome?.querySelector("[data-wiki-title]")).toBeTruthy();
  expect(chrome?.querySelector("[data-wiki-search]")).toBeTruthy();
  expect(chrome?.querySelector("[data-wiki-page-mode-group]")).toBeTruthy();
  expect(chrome?.querySelector("[data-wiki-reading-tools-group]")).toBeTruthy();
  expect(body?.querySelector("[data-wiki-path]")).toBeTruthy();
  expect(body?.querySelector("[data-wiki-meta]")).toBeTruthy();
  expect(body?.querySelector("[data-wiki-article]")).toBeTruthy();
});
```

- [ ] **Step 2: Add the failing layout-style test for internal scroll**

Keep this at the observable boundary by asserting the scroll container exists and picks up internal overflow behavior from the stylesheet, instead of testing implementation trivia in JS.

```ts
it("makes the wiki body the internal vertical scroll container", async () => {
  const page = renderWikiPage();
  document.body.appendChild(page);
  await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

  const body = page.querySelector<HTMLElement>("[data-wiki-body]");
  expect(body).toBeTruthy();
  expect(readRuleStyle(".wiki-page__body", "overflow-y")).toBe("auto");
  expect(readRuleStyle(".wiki-page__main", "grid-template-rows")).toContain("minmax(0, 1fr)");
});
```

- [ ] **Step 3: Add the failing regression test that lead content stays in the scroll body**

This protects the exact user requirement that `wiki/index.md / Updated ...` scroll with content.

```ts
it("keeps the article path and metadata inside the scrollable body", async () => {
  const page = renderWikiPage();
  await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

  const chrome = page.querySelector<HTMLElement>("[data-wiki-chrome]");
  const body = page.querySelector<HTMLElement>("[data-wiki-body]");

  expect(chrome?.querySelector("[data-wiki-path]")).toBeNull();
  expect(chrome?.querySelector("[data-wiki-meta]")).toBeNull();
  expect(body?.querySelector("[data-wiki-path]")).toBeTruthy();
  expect(body?.querySelector("[data-wiki-meta]")).toBeTruthy();
});
```

- [ ] **Step 4: Run the focused page test to verify it fails**

Run: `rtk npm test -- test\web-wiki-page.test.ts`

Expected: FAIL because the current page still renders a flat `main` layout without `data-wiki-chrome` / `data-wiki-body`.

- [ ] **Step 5: Commit the failing-test lock**

```bash
git add test/web-wiki-page.test.ts
git commit -m "test: lock wiki internal scroll layout"
```

---

### Task 2: Restructure the Wiki Markup Into Chrome and Body Regions

**Files:**
- Modify: `D:\Desktop\llm-wiki-compiler-main\web\client\src\pages\wiki\index.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`

- [ ] **Step 1: Wrap the header and tabs in a dedicated chrome container**

Replace the current flat `main` markup segment with an explicit chrome/body split.

```ts
<main class="wiki-page__main">
  <div class="wiki-page__chrome" data-wiki-chrome>
    <header class="wiki-page__header">
      ...
    </header>
    <nav class="wiki-page__tabs" aria-label="Page tools">
      ...
    </nav>
  </div>
  <div class="wiki-page__body" data-wiki-body>
    <section class="wiki-page__lead">
      ...
    </section>
    <div class="wiki-page__article-layout">
      ...
    </div>
    <section class="wiki-page__modules">
      ...
    </section>
  </div>
</main>
```

- [ ] **Step 2: Preserve existing selectors and refs**

Do not rename existing data attributes like:

```ts
data-wiki-title
data-wiki-search
data-wiki-path
data-wiki-meta
data-wiki-article
```

Only add the new wrappers:

```ts
data-wiki-chrome
data-wiki-body
```

This keeps the rest of the page logic unchanged.

- [ ] **Step 3: Run the focused page test to verify the structure now passes**

Run: `rtk npm test -- test\web-wiki-page.test.ts`

Expected: the new wrapper tests pass, while the overflow-style test still fails until CSS is updated.

- [ ] **Step 4: Commit the markup split**

```bash
git add web/client/src/pages/wiki/index.ts test/web-wiki-page.test.ts
git commit -m "refactor: split wiki chrome and body layout"
```

---

### Task 3: Make the Wiki Body the Internal Scroll Container

**Files:**
- Modify: `D:\Desktop\llm-wiki-compiler-main\web\client\assets\styles\wiki-launch.css`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`

- [ ] **Step 1: Turn the main wiki column into a two-row layout**

Change `wiki-page__main` from a plain padded block into a container that can host fixed chrome plus a scrollable body.

```css
.wiki-page__main {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  padding: 24px 28px 32px;
  background: #ffffff;
}
```

- [ ] **Step 2: Add explicit chrome and body rules**

Create the two layout regions.

```css
.wiki-page__chrome {
  min-width: 0;
  background: #ffffff;
}

.wiki-page__body {
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-top: 24px;
}
```

The `padding-top` belongs on the scroll body because `lead` used to rely on static document flow under the tabs.

- [ ] **Step 3: Remove duplicate top margins that would now double-space the body**

Because the body gets top padding, reduce the old top margins that were compensating for the flat layout:

```css
.wiki-page__lead {
  display: flex;
  justify-content: space-between;
  margin-top: 0;
}

.wiki-page__article-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  align-items: start;
  margin-top: 16px;
}

.wiki-page__modules {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}
```

- [ ] **Step 4: Keep mobile behavior valid**

Do not remove the current mobile adjustments; only ensure the new body still scrolls correctly on narrow screens.

```css
@media (max-width: 1040px) {
  .wiki-page__main {
    min-height: 0;
  }

  .wiki-page__body {
    min-height: 0;
  }
}
```

- [ ] **Step 5: Run the focused page test to verify the layout now passes**

Run: `rtk npm test -- test\web-wiki-page.test.ts`

Expected: PASS for the chrome/body structure and internal scroll assertions.

- [ ] **Step 6: Commit the layout CSS**

```bash
git add web/client/assets/styles/wiki-launch.css test/web-wiki-page.test.ts
git commit -m "style: make wiki body scroll beneath fixed chrome"
```

---

### Task 4: Verify Wiki Regressions and Build Stability

**Files:**
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comments.test.ts`

- [ ] **Step 1: Run the focused wiki test pair**

Run: `rtk npm test -- test\web-wiki-page.test.ts test\web-wiki-comments.test.ts`

Expected:

- `web-wiki-page.test.ts` passes with the new internal scroll checks
- `web-wiki-comments.test.ts` still passes, proving the layout split did not break comment behavior

- [ ] **Step 2: Run the adjacent router/link retention checks**

Run: `rtk npm test -- test\web-router.test.ts test\web-page-access-retention.test.ts`

Expected: PASS

- [ ] **Step 3: Run the root build**

Run: `rtk npm run build`

Expected: build succeeds

- [ ] **Step 4: Commit the verification pass**

```bash
git add web/client/src/pages/wiki/index.ts web/client/assets/styles/wiki-launch.css test/web-wiki-page.test.ts
git commit -m "feat: keep wiki chrome fixed above internal scroll"
```

---

## Spec Coverage Check

- fixed header/search/tool row: covered by Task 2 and Task 3
- path/meta scroll with content: covered by Task 1 and Task 2
- internal wiki scroll instead of outer page scroll: covered by Task 1 and Task 3
- no regression for comments/TOC/wiki behavior: covered by Task 4

## Placeholder Scan

- no TODO/TBD markers
- all tasks name exact files
- all verification steps have exact commands
- code steps include concrete snippets rather than vague directions

## Type Consistency Check

- new wrapper selectors are consistently named `data-wiki-chrome` and `data-wiki-body`
- CSS class names match the markup names: `wiki-page__chrome`, `wiki-page__body`
- no new JS interfaces or controller contracts are introduced beyond layout wrappers
