# About Me Profile Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `wiki/about-me.md` into a dedicated high-fidelity personal profile page, entered from the Wiki brand mark, while keeping every other wiki page on the existing Peiweipedia article renderer.

**Architecture:** Keep the existing `#/wiki/<path>` route family and special-case only `wiki/about-me.md`. Add one focused markdown-to-profile parser plus one focused profile renderer module, then keep `web/client/src/pages/wiki/index.ts` as a thin switchboard that decides between the normal article view and the dedicated about-me layout.

**Tech Stack:** TypeScript, DOM rendering, existing `/api/page` route, existing wiki page tests in Vitest + JSDOM, shared `web/client/styles.css`

---

### Task 1: Lock Brand Click and About-Me Special Rendering with Failing UI Tests

**Files:**
- Modify: `D:\Desktop\llm-wiki-compiler-main\test\wiki-clone-data.test.ts`
- Modify: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\wiki-clone-data.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`

- [ ] **Step 1: Write the failing layout assertion for the clickable Wiki brand**

```ts
it("renders the wiki brand as a link to the about-me page", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = input.toString();
    if (url === TREE_URL) {
      return jsonResponse({
        name: "wiki",
        path: "wiki",
        kind: "dir",
        children: [{ name: "wiki", path: "wiki", kind: "dir", children: [] }],
      });
    }
    if (url === INDEX_URL) {
      return jsonResponse({
        path: "wiki/index.md",
        title: "Peiweipedia",
        html: "<h1>Peiweipedia</h1>",
        raw: "# Peiweipedia",
        frontmatter: null,
        modifiedAt: "2026-04-26T08:00:00.000Z",
      });
    }
    return new Response("not found", { status: 404 });
  }));

  const page = renderWikiPage();
  document.body.appendChild(page);

  await waitForText(page, "Peiweipedia");

  const brandLink = page.querySelector<HTMLAnchorElement>("[data-wiki-brand-link]");
  expect(brandLink).toBeTruthy();
  expect(brandLink?.getAttribute("href")).toBe("#/wiki/wiki%2Fabout-me.md");
});
```

- [ ] **Step 2: Write the failing special-layout assertion for `wiki/about-me.md`**

```ts
it("renders wiki/about-me.md with the dedicated profile layout instead of the normal article layout", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = input.toString();
    if (url === TREE_URL) {
      return jsonResponse({
        name: "wiki",
        path: "wiki",
        kind: "dir",
        children: [{ name: "wiki", path: "wiki", kind: "dir", children: [] }],
      });
    }
    if (url === "/api/page?path=wiki%2Fabout-me.md&raw=0") {
      return jsonResponse({
        path: "wiki/about-me.md",
        title: "小松 Xiaosong",
        html: "<h1>小松 Xiaosong</h1>",
        raw: [
          "# 小松 Xiaosong",
          "> 学生 / 个人知识库搭建者 / 自动化系统爱好者",
          "> 用时间线记录成长，用成果库展示能力。",
          "",
          "## 首页",
          "### 标签",
          "- 学习成长",
          "",
          "## 简历",
          "### 联系方式",
          "- Email: xiaosong@example.com",
        ].join("\n"),
        frontmatter: null,
        modifiedAt: "2026-04-26T08:00:00.000Z",
      });
    }
    return new Response("not found", { status: 404 });
  }));

  const page = renderWikiPage("wiki/about-me.md");
  document.body.appendChild(page);

  await waitForText(page, "小松 Xiaosong");

  expect(page.querySelector("[data-about-me-profile]")).toBeTruthy();
  expect(page.querySelector("[data-about-me-tab='首页']")).toBeTruthy();
  expect(page.querySelector("[data-about-me-tab='简历']")).toBeTruthy();
  expect(page.querySelector("[data-wiki-article]")).toBeNull();
});
```

- [ ] **Step 3: Write the failing tab-switch test for the reference-driven panel structure**

```ts
it("switches profile panels in place without changing the wiki route", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = input.toString();
    if (url === TREE_URL) {
      return jsonResponse({
        name: "wiki",
        path: "wiki",
        kind: "dir",
        children: [{ name: "wiki", path: "wiki", kind: "dir", children: [] }],
      });
    }
    if (url === "/api/page?path=wiki%2Fabout-me.md&raw=0") {
      return jsonResponse({
        path: "wiki/about-me.md",
        title: "小松 Xiaosong",
        html: "<h1>小松 Xiaosong</h1>",
        raw: [
          "# 小松 Xiaosong",
          "> 学生 / 个人知识库搭建者 / 自动化系统爱好者",
          "> 用时间线记录成长，用成果库展示能力。",
          "",
          "## 首页",
          "### 总结",
          "首页文案",
          "",
          "## 时间线",
          "### 2023",
          "构建个人知识系统",
          "搭建第二大脑，沉淀方法与思考",
        ].join("\n"),
        frontmatter: null,
        modifiedAt: "2026-04-26T08:00:00.000Z",
      });
    }
    return new Response("not found", { status: 404 });
  }));

  window.location.hash = "#/wiki/wiki%2Fabout-me.md";
  const page = renderWikiPage("wiki/about-me.md");
  document.body.appendChild(page);

  await waitForText(page, "首页文案");

  page.querySelector<HTMLButtonElement>("[data-about-me-tab='时间线']")?.click();

  expect(page.querySelector("[data-about-me-panel='首页']")?.hasAttribute("hidden")).toBe(true);
  expect(page.querySelector("[data-about-me-panel='时间线']")?.hasAttribute("hidden")).toBe(false);
  expect(window.location.hash).toBe("#/wiki/wiki%2Fabout-me.md");
});
```

- [ ] **Step 4: Run the focused tests to verify RED**

Run: `rtk test -- npm test -- test/wiki-clone-data.test.ts test/web-wiki-page.test.ts`
Expected: FAIL because the current Wiki page has no clickable brand link, no `about-me` special template, and no tab-switching profile panels.

- [ ] **Step 5: Commit**

```bash
git add test/wiki-clone-data.test.ts test/web-wiki-page.test.ts
git commit -m "test: lock about-me wiki profile entry behavior"
```

### Task 2: Add a Focused Markdown Parser for `wiki/about-me.md`

**Files:**
- Create: `D:\Desktop\llm-wiki-compiler-main\web\client\src\pages\wiki\about-me-profile-markdown.ts`
- Modify: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`

- [ ] **Step 1: Write the failing parser-level UI assertion through the page test**

```ts
expect(page.querySelector("[data-about-me-stat='知识笔记']")?.textContent).toContain("320+");
expect(page.querySelector("[data-about-me-resume-contact]")?.textContent).toContain("xiaosong@example.com");
expect(page.querySelector("[data-about-me-timeline]")?.textContent).toContain("构建个人知识系统");
```

- [ ] **Step 2: Run the page test to verify RED**

Run: `rtk test -- npm test -- test/web-wiki-page.test.ts`
Expected: FAIL because there is no markdown parser that understands the agreed `about-me.md` section contract.

- [ ] **Step 3: Create the minimal typed parser contract**

```ts
export interface AboutMeProfileData {
  readonly title: string;
  readonly subtitle: string;
  readonly statement: string;
  readonly tabs: readonly AboutMeTabName[];
  readonly home: {
    readonly avatarUrl: string | null;
    readonly tags: readonly string[];
    readonly stats: readonly AboutMeStatItem[];
    readonly strengths: readonly string[];
    readonly summaryHtml: string;
  };
  readonly timeline: readonly AboutMeTimelineItem[];
  readonly achievements: readonly AboutMeAchievementGroup[];
  readonly capability: {
    readonly skills: readonly AboutMeSkillItem[];
    readonly relationships: readonly AboutMeRelationshipItem[];
    readonly strengths: readonly string[];
    readonly photos: readonly string[];
  };
  readonly resume: {
    readonly identity: string[];
    readonly education: string[];
    readonly direction: string[];
    readonly projects: string[];
    readonly skills: string[];
    readonly contacts: string[];
  };
}
```

- [ ] **Step 4: Implement the markdown section parser with fixed section names**

```ts
export function parseAboutMeProfileMarkdown(raw: string, renderedHtml: string): AboutMeProfileData {
  const sections = splitTopLevelSections(raw);
  const title = readTitle(raw) ?? "About Me";
  const quotes = readLeadingQuotes(raw);
  return {
    title,
    subtitle: quotes[0] ?? "",
    statement: quotes[1] ?? "",
    tabs: ["首页", "时间线", "成果库", "能力", "简历"],
    home: {
      avatarUrl: readFirstImage(sections.get("首页")?.raw ?? ""),
      tags: readBulletItems(sectionBody(sections, "首页", "标签")),
      stats: readKeyValueItems(sectionBody(sections, "首页", "统计卡片")),
      strengths: readBulletItems(sectionBody(sections, "首页", "代表能力")),
      summaryHtml: renderFallbackHtml(renderedHtml, "首页"),
    },
    timeline: readTimelineItems(sections.get("时间线")?.raw ?? ""),
    achievements: readAchievementGroups(sections.get("成果库")?.raw ?? ""),
    capability: {
      skills: readSkillItems(sectionBody(sections, "能力", "技能图")),
      relationships: readRelationshipItems(sectionBody(sections, "能力", "关系网络")),
      strengths: readBulletItems(sectionBody(sections, "能力", "代表能力")),
      photos: readImages(sectionBody(sections, "能力", "照片墙")),
    },
    resume: {
      identity: readBulletItems(sectionBody(sections, "简历", "身份")),
      education: readBulletItems(sectionBody(sections, "简历", "教育经历")),
      direction: readBulletItems(sectionBody(sections, "简历", "方向目标")),
      projects: readBulletItems(sectionBody(sections, "简历", "项目经历")),
      skills: readBulletItems(sectionBody(sections, "简历", "核心技能")),
      contacts: readBulletItems(sectionBody(sections, "简历", "联系方式")),
    },
  };
}
```

- [ ] **Step 5: Run the page test to verify GREEN**

Run: `rtk test -- npm test -- test/web-wiki-page.test.ts`
Expected: PASS for the stat card, timeline item, and resume contact assertions once the parser produces stable typed data from `wiki/about-me.md`.

- [ ] **Step 6: Commit**

```bash
git add web/client/src/pages/wiki/about-me-profile-markdown.ts test/web-wiki-page.test.ts
git commit -m "feat: parse about-me markdown into profile data"
```

### Task 3: Build the Dedicated High-Fidelity Profile Renderer

**Files:**
- Create: `D:\Desktop\llm-wiki-compiler-main\web\client\src\pages\wiki\about-me-profile.ts`
- Modify: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`

- [ ] **Step 1: Write the failing visual-structure assertions for the reference-driven layout**

```ts
expect(page.querySelector("[data-about-me-hero]")).toBeTruthy();
expect(page.querySelector("[data-about-me-stats-card]")).toBeTruthy();
expect(page.querySelector("[data-about-me-achievement-board]")).toBeTruthy();
expect(page.querySelector("[data-about-me-timeline-rail]")).toBeTruthy();
expect(page.querySelector("[data-about-me-resume-card]")).toBeTruthy();
expect(page.querySelector("[data-about-me-strength-grid]")).toBeTruthy();
```

- [ ] **Step 2: Run the page test to verify RED**

Run: `rtk test -- npm test -- test/web-wiki-page.test.ts`
Expected: FAIL because the dedicated high-fidelity profile DOM has not been created yet.

- [ ] **Step 3: Create the renderer entry with in-place tab switching**

```ts
export function renderAboutMeProfile(page: {
  path: string;
  title: string | null;
  raw?: string;
  html: string;
  modifiedAt?: string;
}): HTMLElement {
  const data = parseAboutMeProfileMarkdown(page.raw ?? "", page.html);
  const root = document.createElement("section");
  root.className = "about-me-profile";
  root.dataset.aboutMeProfile = "true";
  root.innerHTML = buildAboutMeProfileMarkup(data);
  bindAboutMeTabs(root);
  return root;
}
```

- [ ] **Step 4: Render the approved reference structure instead of a generic article block**

```ts
function buildAboutMeProfileMarkup(data: AboutMeProfileData): string {
  return `
    <div class="about-me-profile__topbar">
      <div class="about-me-profile__brand">
        <div class="about-me-profile__brand-mark">S</div>
        <div class="about-me-profile__brand-copy">
          <strong>${escapeHtml(data.title)}的个人知识库</strong>
          <span>记录成长 · 沉淀价值 · 连接未来</span>
        </div>
      </div>
      <div class="about-me-profile__tabs">
        ${data.tabs.map((tab, index) => `
          <button
            type="button"
            class="about-me-profile__tab${index === 0 ? " is-active" : ""}"
            data-about-me-tab="${tab}"
            aria-pressed="${index === 0 ? "true" : "false"}"
          >${tab}</button>
        `).join("")}
      </div>
    </div>
    <div class="about-me-profile__panel about-me-profile__panel--home" data-about-me-panel="首页">
      <section class="about-me-profile__hero" data-about-me-hero>...</section>
      <section class="about-me-profile__content">
        <div class="about-me-profile__achievement-board" data-about-me-achievement-board>...</div>
        <aside class="about-me-profile__right-rail">
          <section class="about-me-profile__timeline-rail" data-about-me-timeline-rail>...</section>
          <section class="about-me-profile__resume-card" data-about-me-resume-card>...</section>
        </aside>
      </section>
      <section class="about-me-profile__strength-grid" data-about-me-strength-grid>...</section>
    </div>
    <div class="about-me-profile__panel" data-about-me-panel="时间线" hidden>...</div>
    <div class="about-me-profile__panel" data-about-me-panel="成果库" hidden>...</div>
    <div class="about-me-profile__panel" data-about-me-panel="能力" hidden>...</div>
    <div class="about-me-profile__panel" data-about-me-panel="简历" hidden>...</div>
  `;
}
```

- [ ] **Step 5: Run the page test to verify GREEN**

Run: `rtk test -- npm test -- test/web-wiki-page.test.ts`
Expected: PASS with all required profile structural containers present and tab switching happening inside one page container.

- [ ] **Step 6: Commit**

```bash
git add web/client/src/pages/wiki/about-me-profile.ts test/web-wiki-page.test.ts
git commit -m "feat: render dedicated about-me wiki profile"
```

### Task 4: Integrate the Profile Renderer into the Existing Wiki Page Without Breaking Normal Articles

**Files:**
- Modify: `D:\Desktop\llm-wiki-compiler-main\web\client\src\pages\wiki\index.ts`
- Modify: `D:\Desktop\llm-wiki-compiler-main\test\wiki-clone-data.test.ts`
- Modify: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\wiki-clone-data.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`

- [ ] **Step 1: Write the failing regression assertion for ordinary wiki pages**

```ts
expect(page.querySelector("[data-about-me-profile]")).toBeNull();
expect(page.querySelector("[data-wiki-article]")).toBeTruthy();
```

- [ ] **Step 2: Run the focused wiki tests to verify RED**

Run: `rtk test -- npm test -- test/wiki-clone-data.test.ts test/web-wiki-page.test.ts`
Expected: FAIL because the new special-case path is not yet wired through the main `renderWikiPage` flow.

- [ ] **Step 3: Add a dedicated path guard and clickable brand link**

```ts
const ABOUT_ME_PATH = "wiki/about-me.md";

function isAboutMePath(path: string): boolean {
  return path.replace(/\\/g, "/") === ABOUT_ME_PATH;
}
```

```ts
<a class="wiki-page__brand" data-wiki-brand-link href="${wikiHref(ABOUT_ME_PATH)}">
  <div class="wiki-page__mark">F</div>
  <strong>Peiweipedia</strong>
  <span>The Personal Encyclopedia</span>
</a>
```

- [ ] **Step 4: Switch between the normal article renderer and the profile renderer**

```ts
if (page && isAboutMePath(page.path)) {
  renderAboutMeIntoRoot(root, refs, page);
  comments.clear("个人主页模板不使用当前 wiki 正文评论面板。");
} else if (page) {
  renderArticleData(refs, page);
  renderWikiTableOfContents(root, refs);
  await comments.setDocument(page.path, page.html || "", {
    sourceEditable: page.sourceEditable,
    loadOnSet: false,
    contentAlreadyRendered: Boolean(page.html),
    refreshPage: (confirmedPage) => {
      root.dataset.wikiCurrentPath = confirmedPage.path;
      root.dataset.wikiCurrentAnchor = "";
      updatePageChrome(refs, confirmedPage);
      renderWikiTableOfContents(root, refs);
    },
  });
}
```

- [ ] **Step 5: Run the focused wiki tests to verify GREEN**

Run: `rtk test -- npm test -- test/wiki-clone-data.test.ts test/web-wiki-page.test.ts`
Expected: PASS with the special layout only for `wiki/about-me.md` and no regression for ordinary wiki pages.

- [ ] **Step 6: Commit**

```bash
git add web/client/src/pages/wiki/index.ts test/wiki-clone-data.test.ts test/web-wiki-page.test.ts
git commit -m "feat: route about-me wiki path into profile template"
```

### Task 5: Match the Approved Reference Layout in CSS

**Files:**
- Modify: `D:\Desktop\llm-wiki-compiler-main\web\client\styles.css`
- Modify: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-page.test.ts`

- [ ] **Step 1: Write the failing CSS regression assertions for the reference-driven proportions**

```ts
const styles = readFileSync(path.join(process.cwd(), "web", "client", "styles.css"), "utf8");
expect(styles).toContain(".about-me-profile__hero");
expect(styles).toContain("grid-template-columns: 280px minmax(0, 1fr) 470px;");
expect(styles).toContain(".about-me-profile__content");
expect(styles).toContain("grid-template-columns: minmax(0, 1fr) 360px;");
expect(styles).toContain(".about-me-profile__achievement-grid");
expect(styles).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
expect(styles).toContain(".about-me-profile__strength-grid");
expect(styles).toContain("grid-template-columns: repeat(5, minmax(0, 1fr));");
```

- [ ] **Step 2: Run the page test to verify RED**

Run: `rtk test -- npm test -- test/web-wiki-page.test.ts`
Expected: FAIL because the approved profile-specific layout selectors and proportions are not yet in `styles.css`.

- [ ] **Step 3: Add the profile-specific layout rules that mirror the approved reference**

```css
.about-me-profile {
  min-height: 100%;
  padding: 18px 22px 26px;
  background:
    radial-gradient(circle at top left, rgba(126, 130, 255, 0.10), transparent 26%),
    linear-gradient(135deg, #f8fbff 0%, #f9f7ff 52%, #eef4ff 100%);
}

.about-me-profile__hero {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) 470px;
  gap: 26px;
  padding: 28px 30px 22px;
  border-radius: 28px;
}

.about-me-profile__content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 20px;
}

.about-me-profile__achievement-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.about-me-profile__strength-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16px;
}
```

- [ ] **Step 4: Run the page test to verify GREEN**

Run: `rtk test -- npm test -- test/web-wiki-page.test.ts`
Expected: PASS with the layout-specific CSS hooks present for hero, 3x2 achievement region, right rail, and 5-card strengths row.

- [ ] **Step 5: Commit**

```bash
git add web/client/styles.css test/web-wiki-page.test.ts
git commit -m "feat: style about-me profile to match approved layout"
```

### Task 6: Update Project Log and Run Final Verification

**Files:**
- Modify: `D:\Desktop\llm-wiki-compiler-main\docs\project-log.md`

- [ ] **Step 1: Update the Wiki-page section of the project log**

```md
- Wiki 页左上角品牌头像现在可点击进入 `wiki/about-me.md`
- `wiki/about-me.md` 不再按普通百科文章渲染，而是进入专门的个人主页模板
- 个人主页模板采用高保真卡片布局，包含首页、时间线、成果库、能力、简历五个页签
```

- [ ] **Step 2: Run the focused verification suite**

Run: `rtk test -- npm test -- test/wiki-clone-data.test.ts test/web-wiki-page.test.ts`
Expected: PASS with 0 failures.

- [ ] **Step 3: Run the required repository checks**

Run: `rtk tsc --noEmit`
Expected: PASS

Run: `rtk npm run build`
Expected: PASS

Run: `rtk test -- npm test`
Expected: PASS

Run: `rtk err npx fallow`
Expected: PASS with no new dead code, duplication, or complexity issues; if it still fails because of pre-existing repository-wide issues, record the exact counts and confirm the `about-me` feature did not add a new class of failure.

- [ ] **Step 4: Review the final diff before reporting completion**

Run: `rtk git diff -- web/client/src/pages/wiki/index.ts web/client/src/pages/wiki/about-me-profile-markdown.ts web/client/src/pages/wiki/about-me-profile.ts web/client/styles.css test/wiki-clone-data.test.ts test/web-wiki-page.test.ts docs/project-log.md`
Expected: Only the about-me profile entry, parser, renderer, styles, tests, and project-log updates appear.

- [ ] **Step 5: Commit**

```bash
git add web/client/src/pages/wiki/index.ts web/client/src/pages/wiki/about-me-profile-markdown.ts web/client/src/pages/wiki/about-me-profile.ts web/client/styles.css test/wiki-clone-data.test.ts test/web-wiki-page.test.ts docs/project-log.md
git commit -m "feat: add dedicated wiki about-me profile page"
```
