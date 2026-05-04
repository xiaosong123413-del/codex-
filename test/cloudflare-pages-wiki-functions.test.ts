/**
 * Cloudflare Pages hosted wiki function tests.
 *
 * These keep the public web wiki aligned with the desktop wiki renderer's API
 * contract while the data comes from the remote D1 `wiki_pages` table.
 */
import { describe, expect, it } from "vitest";
import { onRequestGet as getPage } from "../functions/api/page.js";
import { onRequestGet as searchPages } from "../functions/api/search.js";
import { onRequestGet as getTree } from "../functions/api/tree.js";
import { onRequestGet as getWikiState } from "../functions/api/wiki-state.js";

const rows = [
  {
    path: "wiki/index.md",
    title: "知识 Wiki",
    content: "# 知识 Wiki\n\n欢迎阅读 [[节点式编程]]。",
    version: "v-index",
    modifiedAt: "2026-04-30T01:00:00.000Z",
  },
  {
    path: "wiki/concepts/node-based-programming.md",
    title: "节点式编程",
    content: "---\ntitle: 节点式编程\n---\n# 节点式编程\n\n使用节点构建流程。",
    version: "v-node",
    modifiedAt: "2026-04-30T02:00:00.000Z",
  },
];

describe("Cloudflare Pages wiki functions", () => {
  it("returns rendered page data in the desktop wiki API shape", async () => {
    const response = await getPage(createContext("/api/page?path=wiki/index.md"));

    expect(response.status).toBe(200);
    const body = await response.json() as { title: string; html: string; raw: string; sourceEditable: boolean };
    expect(body.title).toBe("知识 Wiki");
    expect(body.html).toContain("<h1");
    expect(body.html).toContain("#/wiki/wiki%2F%E8%8A%82%E7%82%B9%E5%BC%8F%E7%BC%96%E7%A8%8B.md");
    expect(body.raw).toContain("[[节点式编程]]");
    expect(body.sourceEditable).toBe(false);
  });

  it("returns a wiki tree that desktop sidebar code can render", async () => {
    const response = await getTree(createContext("/api/tree?layer=wiki"));

    expect(response.status).toBe(200);
    const tree = await response.json() as { name: string; kind: string; children: Array<{ name: string }> };
    expect(tree).toEqual(expect.objectContaining({ name: "wiki", kind: "dir" }));
    expect(tree.children.map((child) => child.name)).toContain("concepts");
  });

  it("returns search results under data.local.results", async () => {
    const response = await searchPages(createContext("/api/search?q=node"));

    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean; data: { local: { results: Array<{ title: string }> } } };
    expect(body.success).toBe(true);
    expect(body.data.local.results).toEqual([
      expect.objectContaining({ title: "节点式编程" }),
    ]);
  });

  it("returns the latest published wiki state for public auto-refresh", async () => {
    const response = await getWikiState(createContext("/api/wiki-state"));

    expect(response.status).toBe(200);
    const body = await response.json() as {
      success: boolean;
      data: { publishVersion: string; publishedAt: string; fileCount: number };
    };
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      publishVersion: "publish-latest",
      publishedAt: "2026-04-30T03:00:00.000Z",
      fileCount: 2,
    });
  });
});

function createContext(path: string) {
  return {
    env: { DB: createDb() },
    request: new Request(`https://llm-wiki.cn${path}`),
  };
}

function createDb() {
  return {
    prepare(sql: string) {
      return {
        bind(...params: string[]) {
          return {
            async first() {
              return selectFirst(sql, params);
            },
            async all() {
              return { results: selectAll(sql, params) };
            },
          };
        },
      };
    },
  };
}

function selectFirst(sql: string, params: string[]) {
  if (sql.includes("FROM wiki_pages WHERE path = ?")) {
    return rows.find((row) => row.path === params[0]) ?? null;
  }
  if (sql.includes("FROM publish_runs")) {
    return {
      publishVersion: "publish-latest",
      publishedAt: "2026-04-30T03:00:00.000Z",
      fileCount: 2,
    };
  }
  return null;
}

function selectAll(sql: string, params: string[]) {
  if (params.length > 1) {
    const query = params[1].replace(/%/g, "");
    return rows.filter((row) => [row.path, row.title, row.content].join(" ").includes(query));
  }
  if (sql.includes("path LIKE ?")) {
    return rows;
  }
  return [];
}
