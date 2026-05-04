/**
 * Parses wiki/个人信息档案/about-me.md into a small, explicit view model for the dedicated
 * personal profile page. The parser intentionally supports only the markdown
 * structures that the profile layout consumes.
 */

export interface AboutMeEntry {
  title: string;
  paragraphs: string[];
  fields: AboutMeField[];
}

export interface AboutMeField {
  label: string;
  value: string;
}

export interface AboutMeSubsection {
  title: string;
  paragraphs: string[];
  bullets: string[];
  fields: AboutMeField[];
  entries: AboutMeEntry[];
}

export interface AboutMeSection {
  title: string;
  paragraphs: string[];
  bullets: string[];
  fields: AboutMeField[];
  subsections: AboutMeSubsection[];
}

export interface AboutMeTimelineEntry {
  year: string;
  title: string;
  description: string;
}

export interface AboutMeProfileDocument {
  title: string;
  subtitle: string;
  quote: string;
  heroTags: string[];
  heroStats: AboutMeField[];
  strengths: string[];
  timeline: AboutMeTimelineEntry[];
  achievements: AboutMeSection;
  ability: AboutMeSection;
  resume: AboutMeSection;
  home: AboutMeSection;
  avatarImage: string | null;
}

interface ParseState {
  title: string;
  quotes: string[];
  sections: AboutMeSection[];
  currentSection: AboutMeSection | null;
  currentSubsection: AboutMeSubsection | null;
  currentEntry: AboutMeEntry | null;
}

export function parseAboutMeProfileMarkdown(markdown: string): AboutMeProfileDocument {
  const state = parseMarkdownSections(markdown);
  const home = findSection(state.sections, "首页");
  const achievements = findSection(state.sections, "成果库");
  const ability = findSection(state.sections, "能力");
  const resume = findSection(state.sections, "简历");
  const timeline = buildTimeline(findSection(state.sections, "时间线"));

  return {
    title: state.title || "About Me",
    subtitle: state.quotes[0] ?? "",
    quote: state.quotes[1] ?? "",
    heroTags: findSubsection(home, "标签")?.bullets ?? [],
    heroStats: findSubsection(home, "统计卡片")?.fields ?? [],
    strengths: buildStrengths(home, ability),
    timeline,
    achievements,
    ability,
    resume,
    home,
    avatarImage: extractAvatarImage(home),
  };
}

function parseMarkdownSections(markdown: string): ParseState {
  const state: ParseState = {
    title: "",
    quotes: [],
    sections: [],
    currentSection: null,
    currentSubsection: null,
    currentEntry: null,
  };
  const lines = markdown.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (tryConsumeTitle(state, line) || tryConsumeQuote(state, line)) {
      continue;
    }
    if (line.startsWith("## ")) {
      startSection(state, line.slice(3).trim());
      continue;
    }
    if (line.startsWith("### ")) {
      startSubsection(state, line.slice(4).trim());
      continue;
    }
    if (line.startsWith("#### ")) {
      startEntry(state, line.slice(5).trim());
      continue;
    }
    appendContentLine(state, line);
  }
  return state;
}

function tryConsumeTitle(state: ParseState, line: string): boolean {
  if (!state.title && line.startsWith("# ")) {
    state.title = line.slice(2).trim();
    return true;
  }
  return false;
}

function tryConsumeQuote(state: ParseState, line: string): boolean {
  if (!state.currentSection && line.startsWith("> ")) {
    state.quotes.push(line.slice(2).trim());
    return true;
  }
  return false;
}

function startSection(state: ParseState, title: string): void {
  const section: AboutMeSection = {
    title,
    paragraphs: [],
    bullets: [],
    fields: [],
    subsections: [],
  };
  state.sections.push(section);
  state.currentSection = section;
  state.currentSubsection = null;
  state.currentEntry = null;
}

function startSubsection(state: ParseState, title: string): void {
  if (!state.currentSection) {
    startSection(state, "首页");
  }
  const subsection: AboutMeSubsection = {
    title,
    paragraphs: [],
    bullets: [],
    fields: [],
    entries: [],
  };
  state.currentSection!.subsections.push(subsection);
  state.currentSubsection = subsection;
  state.currentEntry = null;
}

function startEntry(state: ParseState, title: string): void {
  if (!state.currentSubsection) {
    startSubsection(state, "内容");
  }
  const entry: AboutMeEntry = {
    title,
    paragraphs: [],
    fields: [],
  };
  state.currentSubsection!.entries.push(entry);
  state.currentEntry = entry;
}

function appendContentLine(state: ParseState, line: string): void {
  if (line.startsWith("- ")) {
    appendBullet(state, line.slice(2).trim());
    return;
  }
  appendParagraph(state, line);
}

function appendBullet(state: ParseState, value: string): void {
  const field = toField(value);
  if (state.currentEntry) {
    pushFieldOrBullet(state.currentEntry.fields, null, field, value);
    return;
  }
  if (state.currentSubsection) {
    pushFieldOrBullet(state.currentSubsection.fields, state.currentSubsection.bullets, field, value);
    return;
  }
  if (state.currentSection) {
    pushFieldOrBullet(state.currentSection.fields, state.currentSection.bullets, field, value);
  }
}

function pushFieldOrBullet(
  fields: AboutMeField[],
  bullets: string[] | null,
  field: AboutMeField | null,
  value: string,
): void {
  if (field) {
    fields.push(field);
    return;
  }
  bullets?.push(value);
}

function appendParagraph(state: ParseState, value: string): void {
  if (state.currentEntry) {
    state.currentEntry.paragraphs.push(value);
    return;
  }
  if (state.currentSubsection) {
    state.currentSubsection.paragraphs.push(value);
    return;
  }
  state.currentSection?.paragraphs.push(value);
}

function toField(value: string): AboutMeField | null {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }
  return {
    label: value.slice(0, separatorIndex).trim(),
    value: value.slice(separatorIndex + 1).trim(),
  };
}

function findSection(sections: AboutMeSection[], title: string): AboutMeSection {
  return sections.find((section) => section.title === title) ?? emptySection(title);
}

function emptySection(title: string): AboutMeSection {
  return {
    title,
    paragraphs: [],
    bullets: [],
    fields: [],
    subsections: [],
  };
}

function findSubsection(section: AboutMeSection, title: string): AboutMeSubsection | null {
  return section.subsections.find((subsection) => subsection.title === title) ?? null;
}

function buildStrengths(home: AboutMeSection, ability: AboutMeSection): string[] {
  const homeStrengths = findSubsection(home, "代表能力")?.bullets ?? [];
  if (homeStrengths.length > 0) {
    return homeStrengths;
  }
  return ability.subsections.map((subsection) => subsection.title).filter(Boolean);
}

function buildTimeline(section: AboutMeSection): AboutMeTimelineEntry[] {
  return section.subsections.map((subsection) => ({
    year: subsection.title,
    title: subsection.paragraphs[0] ?? subsection.bullets[0] ?? subsection.title,
    description: subsection.paragraphs[1] ?? subsection.bullets[1] ?? "",
  }));
}

function extractAvatarImage(home: AboutMeSection): string | null {
  const candidates = [
    ...home.paragraphs,
    ...home.subsections.flatMap((subsection) => subsection.paragraphs),
  ];
  for (const candidate of candidates) {
    const match = candidate.match(/!\[[^\]]*]\(([^)]+)\)/);
    if (match) {
      return match[1];
    }
  }
  return null;
}
