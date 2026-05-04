import fs from "node:fs";
import path from "node:path";

const indexPath = ".runtime/ai-vault/.llmwiki/search-index.json";
const entries = JSON.parse(fs.readFileSync(indexPath, "utf8"));

console.log("Total entries:", entries.length);

function matches(entry, query) {
  const q = query.toLowerCase();
  const fields = [
    entry.id,
    entry.title,
    entry.path,
    entry.excerpt,
    entry.searchText,
    ...(entry.tags || []),
  ].filter(Boolean);

  for (const field of fields) {
    if (typeof field === "string" && field.toLowerCase().includes(q)) {
      return true;
    }
  }
  return false;
}

// Test with "MCP"
const query = "MCP";
const results = entries.filter(e => matches(e, query));
console.log(`\nSearch for "${query}": ${results.length} results`);
for (const r of results.slice(0, 5)) {
  console.log(`  - ${r.title} (${r.path})`);
}

// Test with "知识"
const query2 = "知识";
const results2 = entries.filter(e => matches(e, query2));
console.log(`\nSearch for "${query2}": ${results2.length} results`);
for (const r of results2.slice(0, 5)) {
  console.log(`  - ${r.title} (${r.path})`);
}

// Test with "Obsidian"
const query3 = "Obsidian";
const results3 = entries.filter(e => matches(e, query3));
console.log(`\nSearch for "${query3}": ${results3.length} results`);
for (const r of results3.slice(0, 5)) {
  console.log(`  - ${r.title} (${r.path})`);
}

// Check if searchText is populated
const withSearchText = entries.filter(e => e.searchText && e.searchText.length > 0);
console.log(`\nEntries with searchText: ${withSearchText.length}/${entries.length}`);
const withoutSearchText = entries.filter(e => !e.searchText || e.searchText.length === 0);
if (withoutSearchText.length > 0) {
  console.log("Entries WITHOUT searchText:");
  for (const e of withoutSearchText.slice(0, 3)) {
    console.log(`  - ${e.id}`);
  }
}
