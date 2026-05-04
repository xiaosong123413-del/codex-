/**
 * MCP (Model Context Protocol) server for llmwiki.
 *
 * Exposes llmwiki CLI commands as MCP tools, allowing AI agents like
 * Codex and Claude Code to invoke ingest, compile, query, and lint
 * operations programmatically via stdio transport.
 */

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/** Capture stdout/stderr during command execution and return as string. */
async function captureOutput(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => lines.push(args.map(String).join(" "));

  try {
    await fn();
  } catch (err) {
    lines.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }

  return lines.join("\n");
}

/** Create and configure the MCP server with all llmwiki tools. */
function createServer(): McpServer {
  const server = new McpServer({
    name: "llmwiki",
    version: "0.1.1",
  });

  server.tool(
    "ingest",
    "Ingest a URL or local file into the wiki sources directory. Accepts http/https URLs or local .md/.txt file paths.",
    { source: z.string().describe("URL or local file path to ingest") },
    async ({ source }) => {
      const { default: ingestCommand } = await import("./commands/ingest.js");
      const output = await captureOutput(() => ingestCommand(source));
      return { content: [{ type: "text", text: output || "Ingest complete." }] };
    },
  );

  server.tool(
    "compile",
    "Compile all sources into an interlinked wiki. Processes new and changed source files into wiki pages with concept extraction and cross-linking.",
    {},
    async () => {
      const { default: compileCommand } = await import("./commands/compile.js");
      const output = await captureOutput(() => compileCommand());
      return { content: [{ type: "text", text: output || "Compile complete." }] };
    },
  );

  server.tool(
    "query",
    "Ask a natural language question against the wiki. Uses LLM to select relevant pages and generate a cited answer.",
    {
      question: z.string().describe("Natural language question to answer"),
      save: z.boolean().optional().describe("Save the answer as a wiki page"),
    },
    async ({ question, save }) => {
      const { default: queryCommand } = await import("./commands/query.js");
      const output = await captureOutput(() =>
        queryCommand(process.cwd(), question, { save }),
      );
      return { content: [{ type: "text", text: output || "Query complete." }] };
    },
  );

  server.tool(
    "lint",
    "Run quality checks against the wiki. Reports broken links, orphaned pages, missing summaries, and other issues.",
    {},
    async () => {
      const { default: lintCommand } = await import("./commands/lint.js");
      const output = await captureOutput(() => lintCommand());
      return { content: [{ type: "text", text: output || "Lint complete." }] };
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
