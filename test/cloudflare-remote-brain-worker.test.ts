/**
 * Static checks for the Cloudflare Remote Brain Worker template.
 *
 * The project does not pull in a Worker unit-test framework; these assertions
 * keep the MVP contract visible to the root test suite.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workerRoot = path.join(process.cwd(), "cloudflare", "remote-brain-worker");

describe("Cloudflare Remote Brain Worker template", () => {
  it("uses versioned D1 migrations for existing remote databases", () => {
    const workerPackage = fs.readFileSync(path.join(workerRoot, "package.json"), "utf8");
    const initialMigration = fs.readFileSync(
      path.join(workerRoot, "migrations", "0001_initial.sql"),
      "utf8",
    );
    const publishRunsMigration = fs.readFileSync(
      path.join(workerRoot, "migrations", "0002_publish_runs_state.sql"),
      "utf8",
    );

    expect(workerPackage).toContain(
      '"db:migrate": "wrangler d1 migrations apply llm-wiki-remote-brain --remote"',
    );
    expect(initialMigration).toContain("CREATE TABLE IF NOT EXISTS publish_runs");
    expect(initialMigration).not.toContain("publish_version TEXT NOT NULL");
    expect(publishRunsMigration).not.toContain("BEGIN TRANSACTION");
    expect(publishRunsMigration).not.toContain("COMMIT;");
    expect(publishRunsMigration).toContain("CREATE TABLE publish_runs_v2");
    expect(publishRunsMigration).toContain("published_at AS publish_version");
    expect(publishRunsMigration).toContain("'published' AS status");
    expect(publishRunsMigration).toContain("ALTER TABLE publish_runs_v2 RENAME TO publish_runs");
  });

  it("defines the D1 tables required by publish", () => {
    const schema = fs.readFileSync(path.join(workerRoot, "schema.sql"), "utf8");

    expect(schema).toContain("CREATE TABLE IF NOT EXISTS publish_runs");
    expect(schema).toContain("action TEXT NOT NULL");
    expect(schema).toContain("publish_version TEXT NOT NULL");
    expect(schema).toContain("manifest_json TEXT NOT NULL");
    expect(schema).toContain("status TEXT NOT NULL");
    expect(schema).toContain("error TEXT");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS wiki_pages");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS mobile_entries");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS mobile_chats");
    expect(schema).toContain("mode TEXT NOT NULL DEFAULT 'wiki'");
    expect(schema).toContain("content_hash");
    expect(schema).toContain("r2_key");
  });

  it("exposes publish storage and the minimal Remote MCP tools", () => {
    const indexSource = fs.readFileSync(path.join(workerRoot, "src", "index.ts"), "utf8");
    const entrySource = fs.readFileSync(path.join(workerRoot, "src", "mobile-entry-api.ts"), "utf8");
    const eventsSource = fs.readFileSync(path.join(workerRoot, "src", "wiki-publish-events.ts"), "utf8");
    const source = `${indexSource}\n${entrySource}\n${eventsSource}`;

    expect(indexSource).toContain('createExactRoute("POST", "/mcp"');
    expect(indexSource).toContain('createExactRoute("GET", "/wiki/events"');
    expect(indexSource).toContain('rpc.method === "tools/list"');
    expect(indexSource).toContain('"get_page"');
    expect(indexSource).toContain('"search_wiki"');
    expect(source).toContain("publish_runs");
    expect(source).toContain("wiki_pages");
    expect(source).toContain('action: "publish"');
    expect(source).toContain("publishVersion");
    expect(source).toContain("index_file_count");
    expect(source).not.toContain("MAX(content_hash) AS currentWikiVersion");
    expect(source).toContain("status = 'published'");
    expect(source).toContain("publish_version AS currentWikiVersion");
    expect(source).toContain("notifyWikiPublished");
    expect(source).toContain("WIKI_PUBLISH_EVENTS");
    expect(source).toContain("acceptWebSocket");
  });

  it("exposes real Cloudflare adapter endpoints without runtime tests", () => {
    const indexSource = fs.readFileSync(path.join(workerRoot, "src", "index.ts"), "utf8");
    const entrySource = fs.readFileSync(path.join(workerRoot, "src", "mobile-entry-api.ts"), "utf8");
    const chatSource = fs.readFileSync(path.join(workerRoot, "src", "mobile-chat-api.ts"), "utf8");
    const chatHelperSource = fs.readFileSync(path.join(workerRoot, "src", "mobile-chat.ts"), "utf8");
    const workerSupportSource = fs.readFileSync(path.join(workerRoot, "src", "worker-support.ts"), "utf8");
    const source = `${indexSource}\n${entrySource}\n${chatSource}\n${chatHelperSource}\n${workerSupportSource}`;

    expect(indexSource).toContain('createExactRoute("POST", "/llm"');
    expect(indexSource).toContain('createExactRoute("POST", "/ocr"');
    expect(indexSource).toContain('createExactRoute("POST", "/transcribe"');
    expect(indexSource).toContain('createExactRoute("POST", "/embed"');
    expect(indexSource).toContain('createExactRoute("POST", "/vector/query"');
    expect(indexSource).toContain('createExactRoute("POST", "/search"');
    expect(indexSource).toContain('createExactRoute("POST", "/media/upload"');
    expect(indexSource).toContain('createExactRoute("POST", "/mobile/entries"');
    expect(indexSource).toContain('createExactRoute("POST", "/mobile/entries/pending"');
    expect(indexSource).toContain('createExactRoute("POST", "/mobile/entries/status"');
    expect(indexSource).toContain('createExactRoute("POST", "/mobile/wiki/list"');
    expect(indexSource).toContain('createExactRoute("POST", "/mobile/wiki/page"');
    expect(indexSource).toContain('createExactRoute("POST", "/mobile/chat/send"');
    expect(source).toContain("resolveMobileChatMode");
    expect(source).toContain("CLOUDFLARE_SEARCH_ENDPOINT");
    expect(source).toContain("env.AI.run");
    expect(source).toContain("env.VECTORIZE.query");
    expect(source).toContain("env.MEDIA_BUCKET.put");
    expect(source).toContain("env.WIKI_BUCKET.get");
    expect(source).toContain("missing_ai_binding");
    expect(source).toContain("timingSafeEqual");
    expect(source).toContain('crypto.subtle.digest("SHA-256"');
  });

  it("prompts image OCR as verbatim text extraction instead of image description", () => {
    const indexSource = fs.readFileSync(path.join(workerRoot, "src", "index.ts"), "utf8");

    expect(indexSource).toContain("Return only the verbatim OCR text");
    expect(indexSource).toContain("Do not describe the image");
  });

  it("documents required Cloudflare bindings and local env", () => {
    const wrangler = fs.readFileSync(path.join(workerRoot, "wrangler.jsonc.example"), "utf8");
    const readme = fs.readFileSync(path.join(workerRoot, "README.md"), "utf8");

    expect(wrangler).toContain('"compatibility_flags": ["nodejs_compat"]');
    expect(wrangler).toContain('"observability"');
    expect(wrangler).toContain('"binding": "AI"');
    expect(wrangler).toContain('"binding": "MEDIA_BUCKET"');
    expect(wrangler).toContain('"binding": "VECTORIZE"');
    expect(wrangler).toContain('"name": "WIKI_PUBLISH_EVENTS"');
    expect(wrangler).toContain('"class_name": "WikiPublishEvents"');
    expect(wrangler).toContain("LLM_MODEL");
    expect(wrangler).toContain("OCR_MODEL");
    expect(wrangler).toContain("TRANSCRIBE_MODEL");
    expect(wrangler).toContain("EMBEDDING_MODEL");
    expect(wrangler).toContain("CLOUDFLARE_SEARCH_ENDPOINT");
    expect(readme).toContain("mode");
    expect(readme).toContain("hybrid");
    expect(readme).toContain("publishVersion");
    expect(readme).toContain("publish_runs");
    expect(readme).toContain("status='published'");
    expect(readme).toContain("wrangler d1 migrations apply");
    expect(readme).toContain("Authorization: Bearer <REMOTE_TOKEN>");
    expect(readme).toContain("CLOUDFLARE_SEARCH_ENDPOINT");
    expect(readme).toContain("CLOUDFLARE_SEARCH_TOKEN");
    expect(readme).toContain("CLOUDFLARE_WORKER_URL");
    expect(readme).toContain("CLOUDFLARE_REMOTE_TOKEN");
    expect(readme).toContain("REMOTE_TOKEN");
    expect(readme).toContain("wrangler.jsonc");
    expect(readme).toContain("D1");
    expect(readme).toContain("R2");
    expect(readme).toContain("Vectorize");
    expect(readme).toContain("Workers AI");
    expect(readme).toContain("GET /wiki/events");
    expect(readme).toContain("WIKI_PUBLISH_EVENTS");
  });
});
