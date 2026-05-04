/**
 * Verifies the workspace task-plan layout keeps the assistant cards inside the
 * stretch row and lets the task-plan shell consume the full content column.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("workspace task-plan layout css", () => {
  it("stretches the assistant grid with the split pane and fills the task-plan content column", () => {
    const styles = readFileSync(path.join(process.cwd(), "web", "client", "styles.css"), "utf8");

    expect(styles).toMatch(
      /\.workspace-task-plan-poster__assistant\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/,
    );
    expect(styles).toMatch(
      /\.workspace-page\[data-workspace-mode="task-plan"\]\s+\.workspace-page__content\s*\{[\s\S]*grid-template-rows:\s*minmax\(0,\s*1fr\);[\s\S]*min-height:\s*0;/,
    );
    expect(styles).toMatch(
      /\.workspace-page\[data-workspace-mode="task-plan"\]\s+\.workspace-page__body\s*\{[\s\S]*grid-template-rows:\s*minmax\(0,\s*1fr\);[\s\S]*min-height:\s*0;/,
    );
  });

  it("lets the work-log document tree resize freely and collapse to the drag rail", () => {
    const source = readFileSync(path.join(process.cwd(), "web", "client", "src", "pages", "workspace", "index.ts"), "utf8");
    const styles = readFileSync(path.join(process.cwd(), "web", "client", "styles.css"), "utf8");

    expect(source).toContain("maxWidth: 420");
    expect(source).toContain("minWidth: 1");
    expect(source).toContain("WORKSPACE_TREE_COLLAPSE_WIDTH = 24");
    expect(source).toContain("data-workspace-tree-collapsed");
    expect(styles).toMatch(
      /\.workspace-page\[data-workspace-tree-collapsed\]\s+\.workspace-log-shell,[\s\S]*grid-template-columns:\s*0 10px minmax\(0,\s*1fr\);/,
    );
    expect(source).toContain("wiki-page__path-tree workspace-doc-tree__path-tree");
    expect(styles).toMatch(
      /\.workspace-doc-tree__wiki-link\s*\{[\s\S]*color:\s*#0645ad;[\s\S]*text-overflow:\s*ellipsis;/,
    );
  });
});
