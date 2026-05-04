import fs from "node:fs";
import path from "node:path";

const runtimeRoot = ".runtime/ai-vault";
const wikiDir = path.join(runtimeRoot, "wiki");
const indexPath = path.join(runtimeRoot, ".llmwiki", "search-index.json");

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  try {
    const yaml = match[1];
    const result = {};
    const lines = yaml.split("\n");
    let currentKey = "";
    let currentArray = null;
    for (const line of lines) {
      const arrayItem = line.match(/^\s+-\s+(.+)$/);
      if (arrayItem && currentArray) {
        currentArray.push(arrayItem[1].replace(/^['"]|['"]$/g, "").trim());
        continue;
      }
      if (currentArray) { result[currentKey] = currentArray; currentArray = null; }
      const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1];
      let value = kv[2].trim();
      if (value === "" || value === "[]") {
        value = value === "[]" ? [] : "";
      }
      if (typeof value === "string") value = value.replace(/^['"]|['"]$/g, "");
      result[key] = value;
    }
    if (currentArray && currentKey) result[currentKey] = currentArray;
    return { frontmatter: result, body: match[2] };
  } catch { return { frontmatter: {}, body: content }; }
}

function extractH1(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function stemToTitle(relPath) {
  const stem = path.basename(relPath, ".md");
  return stem.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function buildExcerpt(text) {
  const clean = text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .trim();
  const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const excerpt = lines.slice(0, 2).join(" ");
  return excerpt.length > 200 ? `${excerpt.slice(0, 200)}…` : excerpt;
}

function buildSearchText(body) {
  const clean = body
    .replace(/^---\n[\s\S]*?\n---\n?/u, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/[*_~]/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .trim();
  return clean.length > 5000 ? clean.slice(0, 5000) : clean;
}

let count = 0;
let errors = 0;
const entries = [];

function walk(baseDir, currentDir) {
  let items;
  try { items = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
  for (const item of items) {
    const fullPath = path.join(currentDir, item.name);
    if (item.isDirectory()) { walk(baseDir, fullPath); continue; }
    if (!/\.md$/i.test(item.name)) continue;
    try {
      const content = fs.readFileSync(fullPath, "utf8");
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      const logicalPath = `wiki/${relPath}`;
      const { frontmatter, body } = parseFrontmatter(content);
      const title = frontmatter.title || extractH1(body) || stemToTitle(relPath);
      const excerpt = buildExcerpt(frontmatter.summary || body);
      const searchText = buildSearchText(body);
      const stat = fs.statSync(fullPath);
      entries.push({
        id: logicalPath,
        title,
        path: logicalPath,
        layer: "wiki",
        excerpt,
        tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
        modifiedAt: stat.mtime.toISOString(),
        searchText,
      });
      count++;
    } catch (e) { errors++; console.error("Error:", fullPath, e.message); }
  }
}

console.log("Walking:", wikiDir);
walk(wikiDir, wikiDir);
console.log(`Processed: ${count} files, Errors: ${errors}`);

// Check if MCP entry exists
const mcpEntry = entries.find(e => e.title.includes("MCP") || e.id.includes("mcp"));
if (mcpEntry) {
  console.log("\nMCP entry found!");
  console.log("  id:", mcpEntry.id);
  console.log("  title:", mcpEntry.title);
  console.log("  path:", mcpEntry.path);
  console.log("  excerpt:", mcpEntry.excerpt?.slice(0, 100));
  console.log("  searchText (first 200):", mcpEntry.searchText?.slice(0, 200));
} else {
  console.log("\nNo MCP entry found!");
  // Show all entries with 'mcp' or 'MCP' in any field
  const related = entries.filter(e =>
    e.id.toLowerCase().includes("mcp") || e.title.toLowerCase().includes("mcp")
  );
  console.log("Related entries:", related.length);
  for (const r of related) console.log("  -", r.id, "|", r.title);
}

// Write index
const dir = path.dirname(indexPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(indexPath, JSON.stringify(entries, null, 2), "utf8");
console.log(`\nWritten to ${indexPath}, size: ${fs.statSync(indexPath).size} bytes`);
