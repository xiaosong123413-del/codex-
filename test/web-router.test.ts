// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRouter, parseHash, type Route } from "../web/client/src/router.js";

describe("parseHash", () => {
  it("parses a simple route", () => {
    expect(parseHash("#/chat")).toEqual({ name: "chat", params: {} });
  });

  it("extracts a single path parameter", () => {
    expect(parseHash("#/chat/abc-123")).toEqual({ name: "chat", params: { id: "abc-123" } });
  });

  it("extracts a settings section", () => {
    expect(parseHash("#/settings/llm")).toEqual({ name: "settings", params: { section: "llm" } });
  });

  it("parses the standalone wiki route", () => {
    expect(parseHash("#/wiki")).toEqual({ name: "wiki", params: {} });
  });

  it("separates wiki anchors from the page path", () => {
    expect(parseHash("#/wiki/wiki%2F%E8%81%8A%E5%A4%A9%E8%AE%B0%E5%BD%95%2Ftest-chat.md#msg-2026-04-02-00-44")).toEqual({
      name: "wiki",
      params: { path: "wiki/聊天记录/test-chat.md" },
      anchor: "msg-2026-04-02-00-44",
    });
  });

  it("parses the project log route", () => {
    expect(parseHash("#/project-log")).toEqual({ name: "project-log", params: {} });
  });

  it("parses the flash diary route", () => {
    expect(parseHash("#/flash-diary")).toEqual({ name: "flash-diary", params: {} });
  });

  it("parses the sources route", () => {
    expect(parseHash("#/sources")).toEqual({ name: "sources", params: {} });
  });

  it("maps the legacy publish route into app settings", () => {
    expect(parseHash("#/publish")).toEqual({ name: "settings", params: { section: "app-config" } });
  });

  it("parses the workspace route", () => {
    expect(parseHash("#/workspace")).toEqual({ name: "workspace", params: {} });
  });

  it("does not expose task pool as a top-level route", () => {
    expect(parseHash("#/task-pool")).toEqual({ name: "chat", params: {} });
  });

  it("parses graph as a top-level route", () => {
    expect(parseHash("#/graph")).toEqual({ name: "graph", params: {} });
  });

  it("parses workspace child routes", () => {
    expect(parseHash("#/workspace/task-pool/domain/health")).toEqual({
      name: "workspace",
      params: { section: "task-pool/domain/health" },
    });
  });

  it("falls back to the default route for empty or unknown hashes", () => {
    expect(parseHash("")).toEqual({ name: "chat", params: {} });
    expect(parseHash("#/nope")).toEqual({ name: "chat", params: {} });
  });
});

describe("createRouter", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  it("calls onChange with the current route on start", () => {
    const onChange = vi.fn();
    window.location.hash = "#/review";
    const router = createRouter(onChange);
    router.start();
    expect(onChange).toHaveBeenCalledWith({ name: "review", params: {} });
  });

  it("calls onChange on hashchange", () => {
    const onChange = vi.fn();
    const router = createRouter(onChange);
    router.start();
    onChange.mockClear();
    window.location.hash = "#/sync";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(onChange).toHaveBeenCalledWith({ name: "sync", params: {} });
  });

  it("navigate() updates the hash", () => {
    const onChange = vi.fn();
    const router = createRouter(onChange);
    router.start();
    router.navigate({ name: "check" });
    expect(window.location.hash).toBe("#/check");
  });

  it("navigate() can open the wiki reader", () => {
    const onChange = vi.fn();
    const router = createRouter(onChange);
    router.start();
    router.navigate({ name: "wiki" });
    expect(window.location.hash).toBe("#/wiki");
  });

  it("navigate() preserves wiki anchors", () => {
    const onChange = vi.fn();
    const router = createRouter(onChange);
    router.start();
    router.navigate({
      name: "wiki",
      params: { path: "wiki/聊天记录/test-chat.md" },
      anchor: "msg-2026-04-02-00-44",
    });
    expect(window.location.hash).toBe("#/wiki/wiki%2F%E8%81%8A%E5%A4%A9%E8%AE%B0%E5%BD%95%2Ftest-chat.md#msg-2026-04-02-00-44");
  });

  it("navigate() can open the project log", () => {
    const onChange = vi.fn();
    const router = createRouter(onChange);
    router.start();
    router.navigate({ name: "project-log" });
    expect(window.location.hash).toBe("#/project-log");
  });

  it("navigate() can open flash diary", () => {
    const onChange = vi.fn();
    const router = createRouter(onChange);
    router.start();
    router.navigate({ name: "flash-diary" });
    expect(window.location.hash).toBe("#/flash-diary");
  });

  it("navigate() can open sources", () => {
    const onChange = vi.fn();
    const router = createRouter(onChange);
    router.start();
    router.navigate({ name: "sources" });
    expect(window.location.hash).toBe("#/sources");
  });

  it("navigate() can open app settings", () => {
    const onChange = vi.fn();
    const router = createRouter(onChange);
    router.start();
    router.navigate({ name: "settings", params: { section: "app-config" } });
    expect(window.location.hash).toBe("#/settings/app-config");
  });

  it("navigate() can open workspace", () => {
    const onChange = vi.fn();
    const router = createRouter(onChange);
    router.start();
    router.navigate({ name: "workspace" });
    expect(window.location.hash).toBe("#/workspace");
  });

  it("navigate() can open workspace child routes", () => {
    const onChange = vi.fn();
    const router = createRouter(onChange);
    router.start();
    router.navigate({ name: "workspace", params: { section: "task-pool/domain/health" } });
    expect(window.location.hash).toBe("#/workspace/task-pool/domain/health");
  });
});

const sample: Route = { name: "chat", params: {} };
void sample;
