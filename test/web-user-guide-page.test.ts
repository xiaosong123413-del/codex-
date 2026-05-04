// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHash } from "../web/client/src/router.js";
import { renderUserGuidePage } from "../web/client/src/pages/user-guide/index.js";

/**
 * Verifies the settings-hosted user guide and its high-density documentation
 * layout. The page is static by design, so tests assert user-visible content
 * and route integration rather than implementation internals.
 */

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("user guide page", () => {
  it("parses the guide as a settings section route", () => {
    expect(parseHash("#/user-guide")).toEqual({ name: "chat", params: {} });
    expect(parseHash("#/settings/user-guide#settings-layout")).toEqual({
      name: "settings",
      params: { section: "user-guide" },
      anchor: "settings-layout",
    });
  });

  it("renders detailed settings and workflow instructions", () => {
    const page = renderUserGuidePage();
    document.body.appendChild(page);

    expect(page.querySelector("h1")?.textContent).toContain("LLM Wiki 使用说明");
    expect(page.querySelector("#settings-layout")?.textContent).toContain("设置页布置");
    expect(page.textContent).toContain("Provider preset");
    expect(page.textContent).toContain("Chunk 字符数");
    expect(page.textContent).toContain("CLIProxyAPI 出站代理 URL");
    expect(page.textContent).toContain("仓库与同步");
    expect(page.textContent).toContain("日常使用流程");
    expect(page.textContent).toContain("自动化页");
    expect(page.textContent).toContain("项目日志页");
    expect(page.querySelector(".user-guide-page__sidebar")).toBeNull();
    expect(page.querySelector<HTMLAnchorElement>(".user-guide-page__toc a")?.getAttribute("href")).toContain("#/settings/user-guide#");
    expect(page.querySelectorAll(".user-guide-page__section")).toHaveLength(14);
  });

  it("defines the guide as a full-page documentation layout", () => {
    const stylesheet = readFileSync(
      path.resolve(import.meta.dirname, "../web/client/styles.css"),
      "utf8",
    );

    expect(stylesheet).toMatch(/\.user-guide-page\s*\{[\s\S]*height:\s*100%;/);
    expect(stylesheet).toMatch(/\.user-guide-page\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 820px\) 220px;/);
    expect(stylesheet).not.toContain(".user-guide-page__sidebar");
    expect(stylesheet).toContain(".user-guide-page__toc");
  });
});
