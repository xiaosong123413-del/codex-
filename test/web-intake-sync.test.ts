// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadIntakeScan, showIntakeDetectionDialog } from "../web/client/src/intake-sync.js";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("intake sync detection", () => {
  it("loads the intake scan before starting a sync", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            items: [{ kind: "clipping", title: "Source A" }],
            plan: [],
          },
        }),
      })),
    );

    const scan = await loadIntakeScan();

    expect(fetch).toHaveBeenCalledWith("/api/intake/scan");
    expect(scan.items[0]?.title).toBe("Source A");
  });

  it("shows a new-source detection dialog with detected titles", async () => {
    const result = showIntakeDetectionDialog(document.body, {
      items: [
        { kind: "clipping", title: "Clip A" },
        { kind: "source", channel: "\u4e2a\u4eba\u4fe1\u606f", title: "About Me" },
        { kind: "inbox", title: "Inbox B" },
      ],
      plan: [
        {
          file: "剪藏/clip-a.md",
          suggestedLocation: "Knowledge/剪藏/",
          action: "新建",
          reason: "可批量录入",
        },
      ],
    });

    expect(document.body.textContent).toContain("新源料检测");
    expect(document.body.textContent).toContain("Clip A");
    expect(document.body.textContent).toContain("个人信息");
    expect(document.body.textContent).toContain("About Me");
    expect(document.body.textContent).toContain("Inbox B");
    expect(document.querySelector("[data-intake-confirm]")?.textContent).toContain("开始同步编译");

    document.querySelector<HTMLButtonElement>("[data-intake-confirm]")?.click();
    await expect(result).resolves.toBe(true);
  });
});
