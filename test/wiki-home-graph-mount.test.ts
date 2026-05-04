// @vitest-environment jsdom
/**
 * Regression coverage for the Wiki home Graphy mount path.
 *
 * The home cover rebuilds its DOM after loading the tree and index page. This
 * test verifies the rebuilt Graphy container is passed to the graph widget
 * using the active load signal instead of an out-of-scope controller reference.
 */
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mountWikiHomeGraphMock = vi.fn();
const disposeWikiHomeGraphMock = vi.fn();

vi.mock("../web/client/src/pages/wiki/home-graph.js", () => ({
  disposeWikiHomeGraph: disposeWikiHomeGraphMock,
  mountWikiHomeGraph: mountWikiHomeGraphMock,
}));

describe("wiki home Graphy mount", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mountWikiHomeGraphMock.mockClear();
    disposeWikiHomeGraphMock.mockClear();
  });

  it("mounts Graphy after the wiki home cover async refresh", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/tree?")) {
        return jsonResponse({
          name: "wiki",
          path: "wiki",
          kind: "dir",
          children: [
            { name: "index.md", path: "wiki/index.md", kind: "file", modifiedAt: "2026-05-02T00:00:00.000Z" },
            { name: "alpha.md", path: "wiki/alpha.md", kind: "file", modifiedAt: "2026-05-02T01:00:00.000Z" },
          ],
        });
      }
      return jsonResponse({
        path: url.includes("alpha") ? "wiki/alpha.md" : "wiki/index.md",
        title: url.includes("alpha") ? "Alpha" : "Index",
        html: "<h1>Index</h1>",
        raw: "# Index\n\nAbout this wiki.",
        frontmatter: null,
        modifiedAt: "2026-05-02T00:00:00.000Z",
      });
    }));

    const { renderWikiHomeCoverPage } = await import("../web/client/src/pages/wiki/home-cover.js");
    const page = renderWikiHomeCoverPage();
    document.body.append(page);

    await waitForGraphMount();

    const [, container, signal] = mountWikiHomeGraphMock.mock.calls[0]!;
    expect(container).toBe(page.querySelector("[data-wiki-home-graph]"));
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

async function waitForGraphMount(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (mountWikiHomeGraphMock.mock.calls.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Graphy was not mounted");
}
