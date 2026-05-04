# About Me Profile Page Design

## Goal

Turn `wiki/about-me.md` into a dedicated rendered personal profile page.

The entry point is the brand image/mark in the upper-left corner of the Wiki page. Clicking it should open a special profile experience instead of a normal article reading surface.

The content source remains one real markdown file:

- `wiki/about-me.md`

The page must support richer visual composition than the normal Wiki reader, including profile hero content, tabbed sections, card-based modules, and graphics-oriented presentation.

## Confirmed Scope

In scope:

- using `wiki/about-me.md` as the only content source
- making the Wiki brand image/mark clickable
- rendering `wiki/about-me.md` with a dedicated personal-profile template
- supporting these top-level tabs:
  - `首页`
  - `时间线`
  - `成果库`
  - `能力`
  - `简历`
- supporting these module families:
  - 头像/姓名简介
  - 时间线
  - 技能/能力图
  - 项目作品
  - 关系网络
  - 照片墙
  - 联系方式
  - 统计卡片
- keeping markdown as the authoring format
- updating project log for the new Wiki-page behavior

Out of scope:

- adding a second `about-me` content file
- turning all wiki pages into card-driven landing pages
- introducing a generic page-builder or arbitrary visual schema
- replacing the existing Peiweipedia reader for normal wiki articles
- adding backend storage beyond the existing wiki file read path

## Current Problem

The current Wiki page uses one article reader template for every wiki markdown page.

That works for encyclopedia-style pages, but it does not fit the requested personal homepage because:

- the left-top brand mark is only decorative
- `wiki/about-me.md` would currently render like a normal article
- the normal article template does not support the requested dense profile layout
- the requested navigation is tab-based, not long-article scrolling

## Chosen Approach

Use one dedicated personal-profile template that is triggered only for `wiki/about-me.md`.

This keeps the current system simple:

- normal wiki pages still use the existing Peiweipedia article renderer
- only `wiki/about-me.md` switches into the special profile layout
- the route remains inside the Wiki page flow instead of creating a second unrelated content system

This is the shortest correct path because it avoids:

- a new content source
- a new general-purpose routing subsystem
- special behavior leaking into every wiki article

## Route and Entry Design

### Entry Point

The upper-left Wiki brand image/mark becomes an interactive entry.

Behavior:

- clicking the mark opens the `about me` profile experience
- the target content path is fixed to `wiki/about-me.md`

### Route Shape

Do not add a new top-level application section.

Keep the user inside the Wiki route family and special-case the content path:

- route target: `#/wiki/wiki%2Fabout-me.md`

This preserves the existing hash router and keeps the experience anchored to the Wiki page while still allowing a dedicated template.

## Page Model

`wiki/about-me.md` is rendered by a dedicated view model with tab switching inside one page container.

### Tabs

The page header exposes these tabs:

- `首页`
- `时间线`
- `成果库`
- `能力`
- `简历`

Behavior:

- default tab is `首页`
- clicking a tab does not navigate to a different route
- clicking a tab swaps the active content panel inside the profile page
- the active tab has a strong visible selected state

### Overall Visual Direction

The layout should follow the approved reference image very closely, not just loosely in structure.

- light background
- soft blue gradient hero surface
- polished, presentation-style cards
- stronger visual hierarchy than the normal wiki article
- dense but clean information grouping
- a high-fidelity match for spacing, card grouping, tab rhythm, visual weight, and decorative detail

It should feel like a personal knowledge brand page, not an admin dashboard and not a plain article.

## Layout Structure

### 1. Header Navigation

The profile page header contains:

- personal brand mark and site identity on the left
- tab navigation on the right
- lightweight icon-led tabs with a visible selected underline
- a right-edge theme-style circular control

This header belongs to the profile page itself, not the global app shell.

### 2. Home Tab

The `首页` tab contains:

- hero section
- avatar
- name and subtitle
- one main quote or positioning statement
- tag chips
- statistics cards
- a concise “representative strengths” row
- one short closing statement

This tab is the visual landing page and should match the reference most closely.

Important layout rule:

- the upper header + hero region must stay compact enough that the lower content grid visually dominates the page, like the reference

### 3. Timeline Tab

The `时间线` tab contains:

- a dedicated vertical timeline
- year markers
- event titles
- short event descriptions

It is a fuller version of the growth history, not just a tiny summary card.

### 4. Achievement Library Tab

The `成果库` tab contains card groups for:

- 竞赛奖项
- 项目作品
- 课程成果
- 证书与技能
- 公开表达
- 长期作品集

Each group renders as a card section with multiple items.

The home-tab snapshot of this content should visually match the reference layout:

- left main content area
- three cards in the first row
- three cards in the second row
- a separate right rail for timeline and resume

### 5. Capability Tab

The `能力` tab contains:

- skill/capability visualization
- representative capability cards
- relationship network
- optional photos if they help express personal style or collaboration context

The capability visualization should be presentational, not a raw data dump.

### 6. Resume Tab

The `简历` tab contains:

- avatar and name summary
- current identity
- education
- direction/goal
- project experience summary
- core skills summary
- contact information

This tab should read like a concise public-facing resume page.

Reference alignment rule:

- where the reference image says `名片`, this implementation should keep the same spatial role and card style but relabel and interpret it as `简历`

## Markdown Contract

The authoring source remains a normal markdown file with a small set of structural conventions.

Use fixed section names instead of inventing a new DSL.

### Top-Level Structure

The file structure is:

- `# <name>`
- quote lines for subtitle and positioning statement
- `## 首页`
- `## 时间线`
- `## 成果库`
- `## 能力`
- `## 简历`

Only these named sections receive special rendering treatment.

Unknown sections fall back to normal markdown rendering so user content is never discarded.

### Hero Content

The page title:

- `# 小松 Xiaosong`

Quoted blocks immediately below the title are interpreted in order:

1. identity subtitle
2. primary personal statement

Example:

```md
# 小松 Xiaosong
> 学生 / 个人知识库搭建者 / 自动化系统爱好者
> 用时间线记录成长，用成果库展示能力。
```

### Home Tab Subsections

Inside `## 首页`, support these subsections:

- `### 头像`
- `### 标签`
- `### 统计卡片`
- `### 代表能力`
- `### 总结`

Contracts:

- `### 头像`: first markdown image is the profile avatar
- `### 标签`: bullet list of tag chips
- `### 统计卡片`: bullet list of `label: value`
- `### 代表能力`: bullet list of short capability items
- `### 总结`: normal markdown paragraph content

### Timeline Tab Subsections

Inside `## 时间线`:

- each `### <year>` starts one timeline group
- the first paragraph under the year is the event title
- the following paragraph(s) are the event description

### Achievement Library Subsections

Inside `## 成果库`, support these groups:

- `### 竞赛奖项`
- `### 项目作品`
- `### 课程成果`
- `### 证书与技能`
- `### 公开表达`
- `### 长期作品集`

Inside each group:

- each `#### <item title>` begins one card item
- item body is normal markdown
- optional metadata is written as bullet items

Supported metadata bullets:

- `- 时间: ...`
- `- 标签: ...`
- `- 链接: ...`
- `- 图片: ...`

### Capability Tab Subsections

Inside `## 能力`, support:

- `### 技能图`
- `### 关系网络`
- `### 代表能力`
- `### 照片墙`

Contracts:

- `### 技能图`: bullet items follow `能力名 | 分值 | 说明`
- `### 关系网络`: bullet items follow `人物 | 关系 | 说明`
- `### 代表能力`: short card-style bullet items
- `### 照片墙`: markdown image list

### Resume Tab Subsections

Inside `## 简历`, support:

- `### 身份`
- `### 教育经历`
- `### 方向目标`
- `### 项目经历`
- `### 核心技能`
- `### 联系方式`

These subsections render as structured resume cards or lists.

## Rendering Rules

## Reference Fidelity Rules

This feature is not a loose inspiration exercise. It should closely reproduce the approved reference layout in the implemented UI.

The implementation must specifically preserve these traits:

- left brand block with two-line identity
- right aligned icon-style tabs with selected underline
- compact hero card with left avatar, center identity, right statistics
- decorative soft gradient and line/star accents in the hero background
- handwritten-feel slogan placement inside the hero
- large left content board labeled `成果库`
- right rail with `人生时间线` above `简历`
- bottom horizontal `代表能力` card row
- dense card layout with soft shadows and large rounded corners

Allowed change:

- the reference's `名片` wording becomes `简历`

Not allowed:

- replacing the layout with a generic article page
- simplifying the page into a plain dashboard grid
- changing the page into a long scrolling section stack with no tab feel

## Rendering Rules

### Dedicated Template Trigger

When the current wiki path is exactly `wiki/about-me.md`:

- do not render the normal encyclopedia article layout
- render the personal-profile layout instead

For every other page:

- keep the existing wiki reader behavior unchanged

### Fallback Behavior

If one supported subsection is missing:

- hide that module cleanly
- do not show a broken empty widget

If an unsupported subsection appears:

- render it as standard markdown within the nearest tab panel

This keeps the authoring experience flexible without turning the system into a generic page builder.

### Graphics

“多种图形组合” in the first implementation means presentation modules built from markdown-driven data:

- statistics cards
- skill bars or comparable capability graphics
- relationship chips or network-style node grouping
- photo grid
- timeline structure

Do not introduce freeform chart configuration in v1.

## Code Boundaries

### Frontend

The current Wiki page module remains the integration point.

Implementation should:

- keep the brand area clickable
- detect the special `about-me` path
- branch into a dedicated profile renderer
- keep normal wiki rendering isolated from the profile-specific logic

If needed, extract the profile view into its own focused module rather than bloating the main wiki page file.

### Backend

No new persistence layer is needed.

The existing page-read API remains sufficient because the source of truth is still:

- `wiki/about-me.md`

No custom write endpoint is required for this feature.

## Files Likely Affected

- `web/client/src/pages/wiki/index.ts`
- one new focused wiki profile rendering helper or page module under `web/client/src/pages/wiki/`
- `web/client/styles.css`
- `test/wiki-clone-data.test.ts`
- likely one web client Wiki page test covering the new profile entry flow
- `docs/project-log.md`

## Verification

Verification must prove:

1. clicking the Wiki upper-left brand image/mark opens the `about me` experience
2. the source of truth remains `wiki/about-me.md`
3. `wiki/about-me.md` renders with the dedicated profile layout instead of the normal article layout
4. the five tabs `首页 / 时间线 / 成果库 / 能力 / 简历` switch panels correctly
5. supported sections render as specialized modules
6. unsupported markdown content still appears instead of being dropped
7. missing modules hide cleanly
8. normal wiki pages still render unchanged
9. the profile page style matches the intended “personal knowledge brand page” direction rather than collapsing into a plain article
