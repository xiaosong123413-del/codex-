import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

describe("web drawer integration", () => {
  it("opens the drawer from tree selection without navigating the main article view", async () => {
    const source = await readFile(path.join(root, "web", "client", "main.ts"), "utf8");

    expect(source).toContain("renderTree(browserRefs.treeContainer, tree, (path) => {");
    expect(source).toContain("void openDrawerForPath(path);");
    expect(source).toContain("async function loadSourceDrawerContent(pathArg: string)");
    expect(source).toContain("/api/source-gallery?query=");
    expect(source).toContain("/api/source-gallery/${encodeURIComponent(item.id)}");
    expect(source).toContain("function chatReferenceCandidates(pathArg: string)");
    expect(source).toContain("wiki/entities/${id}.md");
    expect(source).toContain("wiki/concepts/${id}.md");
    expect(source).toContain("wiki/queries/${id}.md");
    expect(source).not.toContain("renderTree(browserRefs.treeContainer, tree, (path) => {\r\n    void openDrawerForPath(path);\r\n    void navigateToPage(path);");
    expect(source).not.toContain("renderTree(browserRefs.treeContainer, tree, (path) => {\n    void openDrawerForPath(path);\n    void navigateToPage(path);");
    expect(source).toContain("onNavigate: (path: string) => {\n      void openDrawerForPath(path);");
    expect(source).not.toContain("onNavigate: (path: string) => {\n      void openDrawerForPath(path);\n      void navigateToPage(path);");
  });

  it("delegates chat reference links to the chat page click handler", async () => {
    const source = await readFile(path.join(root, "web", "client", "main.ts"), "utf8");
    const chatSource = await readFile(path.join(root, "web", "client", "src", "pages", "chat", "index.ts"), "utf8");
    const linkSource = await readFile(path.join(root, "web", "client", "src", "shell", "knowledge-preview-links.ts"), "utf8");

    expect(source).toContain("onOpenReference: (path) => {");
    expect(source).toContain("openKnowledgePreview(path);");
    expect(source).not.toContain("bindChatReferenceLinks();");
    expect(chatSource).toContain("handleKnowledgePreviewClick(event, onOpenReference);");
    expect(linkSource).toContain("event.preventDefault();");
    expect(linkSource).toContain("event.stopPropagation();");
    expect(chatSource).toContain("{ capture: true }");
  });

  it("shares the drawer opener with workspace knowledge links", async () => {
    const source = await readFile(path.join(root, "web", "client", "main.ts"), "utf8");
    const mainSlotSource = await readFile(path.join(root, "web", "client", "src", "shell", "main-slot.ts"), "utf8");
    const workspaceSource = await readFile(path.join(root, "web", "client", "src", "pages", "workspace", "index.ts"), "utf8");

    expect(source).toContain("onOpenKnowledgePreview: openKnowledgePreview");
    expect(source).toContain('return routeName === "chat" || routeName === "workspace";');
    expect(mainSlotSource).toContain("onOpenKnowledgePreview: options.onOpenKnowledgePreview");
    expect(workspaceSource).toContain("handleKnowledgePreviewClick(event, options.onOpenKnowledgePreview);");
    expect(workspaceSource).toContain("withKnowledgePreviewLinks(");
  });
});
