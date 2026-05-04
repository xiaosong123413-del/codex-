import { describe, expect, it } from "vitest";
import {
  clampAutomationMermaidScale,
  computeAutomationMermaidDraggedScroll,
  computeAutomationMermaidFitScale,
  computeAutomationMermaidScrollOffset,
  computeAutomationMermaidViewportLayout,
} from "../web/client/src/pages/automation/mermaid-viewport.js";

describe("automation mermaid viewport", () => {
  it("clamps workflow zoom to the supported range", () => {
    expect(clampAutomationMermaidScale(0.1)).toBe(0.45);
    expect(clampAutomationMermaidScale(1.4)).toBe(1.4);
    expect(clampAutomationMermaidScale(3.8)).toBe(2.8);
  });

  it("fits narrow diagrams up to the capped initial zoom level", () => {
    expect(computeAutomationMermaidFitScale(960, 220)).toBe(1.8);
    expect(computeAutomationMermaidFitScale(480, 960)).toBeLessThan(1);
  });

  it("keeps the pointer focus stable when the workflow zoom changes", () => {
    const nextScroll = computeAutomationMermaidScrollOffset(120, 180, 1, 1.5);

    expect(nextScroll).toBeCloseTo(270);
  });

  it("centers narrow diagrams without changing the zoom focus math", () => {
    const previousLayout = computeAutomationMermaidViewportLayout(960, { width: 1200, height: 800 }, 0.5);
    const nextLayout = computeAutomationMermaidViewportLayout(960, { width: 1200, height: 800 }, 0.8);
    const nextScroll = computeAutomationMermaidScrollOffset(0, 480, 0.5, 0.8, previousLayout.insetLeft, nextLayout.insetLeft);

    expect(previousLayout.insetLeft).toBe(180);
    expect(nextLayout.insetLeft).toBe(0);
    expect(nextScroll).toBeCloseTo(0);
  });

  it("can center the main workflow spine instead of the full diagram midpoint", () => {
    const layout = computeAutomationMermaidViewportLayout(848, { width: 848, height: 1576 }, 1, 323);

    expect(layout.insetLeft).toBeCloseTo(101);
    expect(layout.frameWidth).toBeCloseTo(949);
  });

  it("keeps extra scroll room below long workflow diagrams", () => {
    const layout = computeAutomationMermaidViewportLayout(960, { width: 700, height: 1200 }, 1, 350);

    expect(layout.frameHeight).toBe(1320);
  });

  it("converts pointer drag distance into viewport scroll movement", () => {
    expect(computeAutomationMermaidDraggedScroll({
      startX: 220,
      startY: 140,
      startScrollLeft: 80,
      startScrollTop: 36,
    }, 180, 104)).toEqual({
      left: 120,
      top: 72,
    });
  });
});
