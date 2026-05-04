import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
// @ts-expect-error - no types shipped
import attrs from "markdown-it-attrs";
// @ts-expect-error - no types shipped
import texmath from "markdown-it-texmath";
import katex from "katex";
import path from "node:path";
import fs from "node:fs";
import yaml from "js-yaml";
import { normalizeMarkdownHeadingAnchor } from "./heading-anchors.js";
import { wikilinksPlugin, type WikilinkResolver } from "./wikilinks.js";

interface RenderedPage {
  html: string;
  frontmatter: Record<string, unknown> | null;
  rawMarkdown: string;
  title: string | null;
}

interface RendererOptions {
  pageLookupRoot?: string;
  headingPermalinks?: boolean;
  wikilinkResolver?: WikilinkResolver;
}

export function createRenderer(opts: RendererOptions) {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: false,
  });

  md.use(attrs, {});
  md.use(anchor, {
    slugify: normalizeMarkdownHeadingAnchor,
    ...(opts.headingPermalinks === false
      ? {}
      : {
          permalink: anchor.permalink.linkInsideHeader({
            symbol: "§",
            placement: "before",
          }),
        }),
  });
  md.use(texmath, {
    engine: katex,
    delimiters: "dollars",
    katexOptions: { throwOnError: false, strict: false },
  });

  const resolver: WikilinkResolver = opts.wikilinkResolver ?? ((target) => {
    if (!opts.pageLookupRoot) {
      return {
        href: `/?page=${encodeURIComponent(target)}`,
        exists: false,
      };
    }

    const candidate = findPage(opts.pageLookupRoot, target);
    if (candidate) {
      const rel = path.relative(opts.pageLookupRoot, candidate).split(path.sep).join("/");
      return {
        href: `/?page=${encodeURIComponent(rel)}`,
        exists: true,
      };
    }
    return {
      href: `/?page=${encodeURIComponent(target)}`,
      exists: false,
    };
  });

  md.use(wikilinksPlugin, resolver);

  // Attach data-source-line to every top-level block token so the client can
  // map DOM selections back to source lines.
  md.core.ruler.push("source-line", (state) => {
    for (const tok of state.tokens) {
      if (tok.map && tok.level === 0 && tok.type.endsWith("_open")) {
        tok.attrSet("data-source-line", `${tok.map[0]},${tok.map[1]}`);
      }
    }
  });

  // Customize fence rendering so mermaid blocks are left for the client to render.
  const defaultFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const tok = tokens[idx]!;
    const info = (tok.info || "").trim();
    const lang = info.split(/\s+/)[0];
    if (lang === "mermaid") {
      const line =
        tok.map && tok.level === 0
          ? ` data-source-line="${tok.map[0]},${tok.map[1]}"`
          : "";
      return `<pre class="mermaid-block"${line}><code class="language-mermaid">${escapeHtml(tok.content)}</code></pre>\n`;
    }
    return defaultFence(tokens, idx, options, env, self);
  };

  return {
    render(rawMarkdown: string): RenderedPage {
      const { frontmatter, body, title } = stripFrontmatter(rawMarkdown);
      const html = md.render(body);
      return { html, frontmatter, rawMarkdown, title };
    },
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function stripFrontmatter(text: string): {
  frontmatter: Record<string, unknown> | null;
  body: string;
  title: string | null;
} {
  const normalizedText = text.replace(/^\uFEFF/, "");
  const m = FRONTMATTER_RE.exec(normalizedText);
  let frontmatter: Record<string, unknown> | null = null;
  let body = normalizedText;
  if (m) {
    frontmatter = parseYamlFrontmatter(m[1] ?? "");
    body = normalizedText.slice(m[0].length);
  }
  const h1 = /^#\s+(.+?)\s*$/m.exec(body);
  const title =
    (frontmatter && typeof frontmatter.title === "string" && (frontmatter.title as string)) ||
    (h1 && h1[1]) ||
    null;
  return { frontmatter, body, title };
}

function parseYamlFrontmatter(value: string): Record<string, unknown> | null {
  try {
    const parsed = yaml.load(value);
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve a wikilink target to a file under the wiki namespace root. Tries:
 *   - the exact relative path as given
 *   - that path + ".md"
 *   - a search for any md file whose stem === target
 *   - a search for any md file whose basename === target
 */
export function findPage(pageLookupRoot: string, target: string): string | null {
  const wikiDir = path.join(pageLookupRoot, "wiki");
  if (!fs.existsSync(wikiDir) || !fs.statSync(wikiDir).isDirectory()) {
    return null;
  }

  const tryPath = (rel: string): string | null => {
    const normalized = rel.split("/").join(path.sep);
    const full = path.join(wikiDir, normalized);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    return null;
  };

  const direct =
    tryPath(target) ||
    tryPath(target + ".md");
  if (direct) return direct;

  // Fallback: scan wiki/ for matching stem.
  const match = findByStem(wikiDir, target);
  return match;
}

function findByStem(dir: string, target: string): string | null {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = findByStem(full, target);
      if (sub) return sub;
    } else if (e.isFile() && e.name.endsWith(".md")) {
      const stem = e.name.replace(/\.md$/, "");
      if (stem === target || e.name === target) return full;
    }
  }
  return null;
}
