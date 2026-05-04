#!/usr/bin/env node
/**
 * Build the Cloudflare Pages wiki bundle.
 *
 * The hosted web wiki intentionally reuses the desktop WebUI wiki renderer
 * instead of the older static HTML exporter. The output directory stays
 * `dist/static-wiki` so the existing Pages deployment command and wrangler
 * configuration continue to work.
 */
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const projectRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const webRoot = path.join(projectRoot, "web");
const outDir = path.join(projectRoot, "dist", "static-wiki");
const assetsDir = path.join(outDir, "assets");
const stylesDir = path.join(assetsDir, "styles");
const buildTime = new Date().toISOString();
const buildVersion = buildTime.replace(/[-:.TZ]/g, "").slice(0, 14);
const publicWikiEventsUrl = readPublicWikiEventsUrl();
const publicWikiEntry = [
  'import { renderWikiPage } from "./src/pages/wiki/index.js";',
  "",
  'const DEFAULT_WIKI_PATH = "wiki/index.md";',
  `const WIKI_EVENTS_URL = ${JSON.stringify(publicWikiEventsUrl)};`,
  'const root = document.getElementById("public-wiki-root");',
  "",
  "if (!root) {",
  '  throw new Error("Missing public wiki root.");',
  "}",
  "",
  "let mounted = null;",
  'let currentPublishVersion = "";',
  "let wikiEventsSocket = null;",
  "",
  "if (!window.location.hash) {",
  "  window.location.replace(wikiHref(DEFAULT_WIKI_PATH));",
  "} else {",
  "  mountCurrentRoute();",
  "}",
  "",
  'window.addEventListener("hashchange", mountCurrentRoute);',
  "connectWikiEvents();",
  "document.addEventListener(\"visibilitychange\", () => {",
  "  if (!document.hidden) {",
  "    connectWikiEvents();",
  "  }",
  "});",
  "window.addEventListener(\"online\", connectWikiEvents);",
  "window.addEventListener(\"beforeunload\", () => {",
  "  wikiEventsSocket?.close();",
  "});",
  "",
  "function mountCurrentRoute() {",
  "  const route = readWikiRoute(window.location.hash);",
  "  mounted?.__dispose?.();",
  "  mounted = renderWikiPage(route.path, route.anchor);",
  "  root.replaceChildren(mounted);",
  '  document.title = "Peiweipedia · LLM Wiki";',
  "}",
  "",
  "function connectWikiEvents() {",
  "  if (!WIKI_EVENTS_URL || !(\"WebSocket\" in window)) {",
  "    return;",
  "  }",
  "  if (wikiEventsSocket && wikiEventsSocket.readyState <= WebSocket.OPEN) {",
  "    return;",
  "  }",
  "  wikiEventsSocket = new WebSocket(WIKI_EVENTS_URL);",
  "  wikiEventsSocket.addEventListener(\"message\", handleWikiEventMessage);",
  "  wikiEventsSocket.addEventListener(\"close\", () => {",
  "    wikiEventsSocket = null;",
  "  });",
  "}",
  "",
  "function handleWikiEventMessage(event) {",
  "  const payload = parseWikiEvent(event.data);",
  "  if (!payload || payload.type !== \"wiki-published\") {",
  "    return;",
  "  }",
  "  const nextVersion = String(payload.publishVersion ?? \"\");",
  "  if (!nextVersion || nextVersion === currentPublishVersion) {",
  "    return;",
  "  }",
  "  currentPublishVersion = nextVersion;",
  "  mountCurrentRoute();",
  "}",
  "",
  "function parseWikiEvent(value) {",
  "  try {",
  "    return JSON.parse(String(value));",
  "  } catch {",
  "    return null;",
  "  }",
  "}",
  "",
  "function readWikiRoute(hash) {",
  '  if (!hash.startsWith("#/wiki")) {',
  "    return { path: DEFAULT_WIKI_PATH, anchor: \"\" };",
  "  }",
  '  const payload = hash.slice("#/wiki".length).replace(/^\\//u, "");',
  '  const anchorIndex = payload.indexOf("#");',
  "  const hasAnchor = anchorIndex >= 0;",
  "  const encodedPath = hasAnchor ? payload.slice(0, anchorIndex) : payload;",
  "  const encodedAnchor = hasAnchor ? payload.slice(anchorIndex + 1) : \"\";",
  "  return {",
  "    path: encodedPath ? decodeURIComponent(encodedPath) : DEFAULT_WIKI_PATH,",
  "    anchor: encodedAnchor ? decodeURIComponent(encodedAnchor) : \"\",",
  "  };",
  "}",
  "",
  "function wikiHref(path) {",
  '  return `#/wiki/${encodeURIComponent(path)}`;',
  "}",
].join("\n");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(stylesDir, { recursive: true });

await esbuild.build({
  stdin: {
    contents: publicWikiEntry,
    resolveDir: path.join(webRoot, "client"),
    sourcefile: "public-wiki-entry.js",
    loader: "js",
  },
  bundle: true,
  format: "esm",
  target: "es2020",
  platform: "browser",
  outfile: path.join(assetsDir, "public-wiki.js"),
  sourcemap: false,
  treeShaking: true,
  minify: true,
  logLevel: "info",
  define: {
    __BUILD_VERSION__: JSON.stringify(buildVersion),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
});

writeIndexHtml();
copyClientStyles();
copyKatexStyles();

console.log(`public wiki bundled to ${outDir} (${buildVersion})`);

function readPublicWikiEventsUrl() {
  const workerUrl = normalizeEnvValue(
    process.env.CLOUDFLARE_WORKER_URL ?? readDotEnvValue("CLOUDFLARE_WORKER_URL"),
  );
  return workerUrl ? toWebSocketEventsUrl(workerUrl) : "";
}

function toWebSocketEventsUrl(workerUrl) {
  try {
    const eventsUrl = new URL("/wiki/events", workerUrl);
    eventsUrl.protocol = webSocketProtocol(eventsUrl.protocol);
    return eventsUrl.href;
  } catch {
    return "";
  }
}

function webSocketProtocol(protocol) {
  return protocol === "http:" ? "ws:" : "wss:";
}

function readDotEnvValue(name) {
  const envPath = path.join(projectRoot, ".env");
  if (!fs.existsSync(envPath)) return "";
  const pattern = new RegExp(`^\\s*${escapeRegExp(name)}\\s*=\\s*(.*)\\s*$`, "m");
  const match = pattern.exec(fs.readFileSync(envPath, "utf8"));
  return match ? normalizeEnvValue(match[1]) : "";
}

function normalizeEnvValue(value) {
  return String(value ?? "").trim().replace(/^["']|["']$/g, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function writeIndexHtml() {
  fs.writeFileSync(path.join(outDir, "index.html"), `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Peiweipedia · LLM Wiki</title>
    <link rel="preconnect" href="https://rsms.me/" />
    <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap" />
    <link rel="stylesheet" href="/assets/styles/tokens.css?v=${buildVersion}" />
    <link rel="stylesheet" href="/assets/styles/base.css?v=${buildVersion}" />
    <link rel="stylesheet" href="/assets/styles/components.css?v=${buildVersion}" />
    <link rel="stylesheet" href="/assets/styles/feedback.css?v=${buildVersion}" />
    <link rel="stylesheet" href="/assets/styles/wiki-home-cover.css?v=${buildVersion}" />
    <link rel="stylesheet" href="/assets/styles/wiki-launch.css?v=${buildVersion}" />
    <link rel="stylesheet" href="/assets/styles/wiki-relation-graph.css?v=${buildVersion}" />
    <link rel="stylesheet" href="/assets/styles/identity-info-profile.css?v=${buildVersion}" />
    <link rel="stylesheet" href="/assets/styles/identity-info-profile-panels.css?v=${buildVersion}" />
    <link rel="stylesheet" href="/assets/styles.css?v=${buildVersion}" />
    <link rel="stylesheet" href="/katex/katex.min.css?v=${buildVersion}" />
    <style>
      html,
      body,
      #public-wiki-root {
        width: 100%;
        height: 100%;
        min-height: 100%;
      }

      body.public-wiki-body {
        margin: 0;
        overflow: hidden;
        background: #f8f9fa;
      }

      #public-wiki-root {
        display: block;
      }
    </style>
  </head>
  <body class="public-wiki-body">
    <main id="public-wiki-root"></main>
    <script type="module" src="/assets/public-wiki.js?v=${buildVersion}"></script>
  </body>
</html>
`, "utf8");
}

function copyClientStyles() {
  fs.copyFileSync(
    path.join(webRoot, "client", "styles.css"),
    path.join(assetsDir, "styles.css"),
  );
  const sourceDir = path.join(webRoot, "client", "assets", "styles");
  for (const name of fs.readdirSync(sourceDir)) {
    const source = path.join(sourceDir, name);
    if (fs.statSync(source).isFile()) {
      fs.copyFileSync(source, path.join(stylesDir, name));
    }
  }
}

function copyKatexStyles() {
  const katexSource = path.join(webRoot, "node_modules", "katex", "dist", "katex.min.css");
  if (!fs.existsSync(katexSource)) {
    return;
  }
  const katexOutDir = path.join(outDir, "katex");
  fs.mkdirSync(katexOutDir, { recursive: true });
  fs.copyFileSync(katexSource, path.join(katexOutDir, "katex.min.css"));
}
