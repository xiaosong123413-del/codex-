/**
 * Verifies the hosted public wiki shell keeps the same viewport boundary as
 * the desktop shell. Without this, the long wiki sidebar stretches the home
 * page grid and pushes the hero/cards thousands of pixels down the page.
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

describe("public wiki build shell", () => {
  it("pins the public wiki root to the viewport", async () => {
    const script = await readFile(path.join(root, "scripts", "build-public-wiki.mjs"), "utf8");

    expect(script).toContain("html,");
    expect(script).toContain("body,");
    expect(script).toContain("#public-wiki-root");
    expect(script).toContain("height: 100%");
    expect(script).toContain("overflow: hidden");
  });

  it("subscribes to wiki publish events and remounts the current route on changes", async () => {
    const script = await readFile(path.join(root, "scripts", "build-public-wiki.mjs"), "utf8");

    expect(script).toContain("/wiki/events");
    expect(script).toContain("new WebSocket(WIKI_EVENTS_URL)");
    expect(script).toContain("handleWikiEventMessage");
    expect(script).toContain("wiki-published");
    expect(script).toContain("currentPublishVersion = nextVersion");
    expect(script).toContain("mountCurrentRoute();");
    expect(script).not.toContain("WIKI_STATE_VISIBLE_POLL_MS");
    expect(script).not.toContain("setTimeout");
  });
});
