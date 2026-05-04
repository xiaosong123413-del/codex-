// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountRail } from "../web/client/src/shell/rail.js";

describe("mountRail", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("renders the navigation buttons in order", () => {
    const container = document.getElementById("root") as HTMLElement;
    mountRail(container, { current: "chat", onNavigate: vi.fn() });

    const names = [...container.querySelectorAll<HTMLButtonElement>("[data-route]")].map((button) =>
      button.dataset.route,
    );
    expect(names).toEqual([
      "workspace",
      "chat",
      "flash-diary",
      "sources",
      "wiki",
      "check",
      "sync",
      "review",
      "settings",
    ]);
  });

  it("marks the current route as active and updates it later", () => {
    const container = document.getElementById("root") as HTMLElement;
    const handle = mountRail(container, { current: "chat", onNavigate: vi.fn() });

    expect(container.querySelector('[data-route="chat"]')?.getAttribute("data-active")).toBe("true");
    expect(container.querySelector('[data-route="workspace"]')?.getAttribute("aria-label")).toBe("\u5de5\u4f5c\u53f0");
    expect(container.querySelector('[data-route="flash-diary"]')?.getAttribute("aria-label")).toBe("\u95ea\u5ff5\u65e5\u8bb0");
    expect(container.querySelector('[data-route="wiki"]')?.getAttribute("aria-label")).toBe("wiki");
    expect(container.querySelector('[data-route="user-guide"]')).toBeNull();
    expect(container.querySelector('[data-route="review"]')?.getAttribute("data-active")).toBe("false");

    handle.update("review");

    expect(container.querySelector('[data-route="chat"]')?.getAttribute("data-active")).toBe("false");
    expect(container.querySelector('[data-route="review"]')?.getAttribute("data-active")).toBe("true");
  });

  it("highlights settings for settings-backed secondary pages", () => {
    const container = document.getElementById("root") as HTMLElement;
    const handle = mountRail(container, { current: "chat", onNavigate: vi.fn() });

    handle.update("automation");
    expect(container.querySelector('[data-route="settings"]')?.getAttribute("data-active")).toBe("true");

    handle.update("project-log");
    expect(container.querySelector('[data-route="settings"]')?.getAttribute("data-active")).toBe("true");
  });

  it("invokes navigation when a button is clicked", () => {
    const container = document.getElementById("root") as HTMLElement;
    const onNavigate = vi.fn();
    mountRail(container, { current: "chat", onNavigate });

    container.querySelector<HTMLButtonElement>('[data-route="workspace"]')?.click();

    expect(onNavigate).toHaveBeenCalledWith("workspace");
  });

});
