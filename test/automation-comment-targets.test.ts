// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  collectMermaidTargetAnchors,
  resolveCommentPinPosition,
  resolveMermaidDraftTarget,
} from "../web/client/src/pages/automation/mermaid-comments.js";
import { resolveMermaidTargetLabel } from "../web/client/src/pages/automation/mermaid-targets.js";

describe("automation comment targets", () => {
  it("prefers the clicked node instead of resolving everything as canvas", () => {
    const { surface, svg } = renderMermaidSurface();
    const anchors = collectMermaidTargetAnchors(svg);
    const nodeRect = svg.querySelector<SVGRectElement>("#trigger rect");
    if (!nodeRect) {
      throw new Error("node rect not rendered");
    }

    const draft = resolveMermaidDraftTarget(
      { surface, svg, anchors },
      nodeRect,
      { clientX: 130, clientY: 86 },
    );

    expect(draft).toEqual({
      targetType: "node",
      targetId: "trigger",
      pinnedX: 100,
      pinnedY: 70,
    });
  });

  it("uses the real click position for canvas comments", () => {
    const { surface, svg } = renderMermaidSurface();
    const anchors = collectMermaidTargetAnchors(svg);

    const draft = resolveMermaidDraftTarget(
      { surface, svg, anchors },
      svg,
      { clientX: 250, clientY: 170 },
    );

    expect(draft).toEqual({
      targetType: "canvas",
      targetId: "canvas",
      pinnedX: 200,
      pinnedY: 120,
    });
  });

  it("stores the stable data-id instead of Mermaid runtime node ids", () => {
    const { surface, svg } = renderRuntimeIdSurface();
    const anchors = collectMermaidTargetAnchors(svg);
    const nodeShape = svg.querySelector<SVGRectElement>("g.node[data-id='E'] rect");
    if (!nodeShape) {
      throw new Error("runtime node shape not rendered");
    }

    const draft = resolveMermaidDraftTarget(
      { surface, svg, anchors },
      nodeShape,
      { clientX: 200, clientY: 90 },
    );

    expect(draft).toEqual({
      targetType: "node",
      targetId: "E",
      pinnedX: 180,
      pinnedY: 80,
    });
  });

  it("recovers legacy flowchart node ids to the visible node label", () => {
    const { svg } = renderRuntimeIdSurface();
    const anchors = collectMermaidTargetAnchors(svg);
    const comment = {
      id: "comment-1",
      automationId: "daily-sync",
      targetType: "node" as const,
      targetId: "flowchart-E-319",
      text: "这个可以吗",
      createdAt: "2026-04-27T10:00:00.000Z",
      updatedAt: "2026-04-27T10:00:00.000Z",
      pinnedX: 180,
      pinnedY: 80,
    };

    expect(resolveMermaidTargetLabel(comment, anchors)).toBe("用户下一步做什么");
    expect(resolveCommentPinPosition(comment, anchors)).toEqual({
      x: 180,
      y: 80,
      orphaned: false,
    });
  });

  it("maps translated rect nodes back to global svg coordinates without getCTM", () => {
    const { svg } = renderTranslatedRectSurface();
    const anchors = collectMermaidTargetAnchors(svg);

    expect(anchors.find((anchor) => anchor.targetId === "C")).toEqual({
      targetType: "node",
      targetId: "C",
      x: 323,
      y: 247.5,
      label: "汇总所有 Workflow listWorkspaceAutomations()",
    });
  });

  it("prefers svg translate attributes when getCTM incorrectly returns identity", () => {
    const { svg } = renderTranslatedRectSurfaceWithIdentityMatrix();
    const anchors = collectMermaidTargetAnchors(svg);

    expect(anchors.find((anchor) => anchor.targetId === "C")).toEqual({
      targetType: "node",
      targetId: "C",
      x: 323,
      y: 247.5,
      label: "汇总所有 Workflow listWorkspaceAutomations()",
    });
  });

  it("maps translated polygon branch nodes back to global svg coordinates", () => {
    const { svg } = renderTranslatedPolygonSurface();
    const anchors = collectMermaidTargetAnchors(svg);

    expect(anchors.find((anchor) => anchor.targetId === "E")).toEqual({
      targetType: "node",
      targetId: "E",
      x: 323,
      y: 526,
      label: "用户下一步做什么",
    });
  });
});

function renderMermaidSurface(): { surface: HTMLElement; svg: SVGSVGElement } {
  const surface = document.createElement("div");
  surface.innerHTML = `
    <svg viewBox="0 0 400 240" width="400" height="240">
      <g class="node" id="trigger">
        <rect x="60" y="50" width="80" height="40"></rect>
      </g>
      <g class="edgePath" id="edge-trigger-action">
        <path d="M100,70 L300,180"></path>
      </g>
      <g class="node" id="action">
        <rect x="260" y="160" width="80" height="40"></rect>
      </g>
    </svg>
  `;
  const svg = surface.querySelector<SVGSVGElement>("svg");
  if (!svg) {
    throw new Error("svg not rendered");
  }
  stubSurfaceRect(surface);
  return { surface, svg };
}

function renderRuntimeIdSurface(): { surface: HTMLElement; svg: SVGSVGElement } {
  const surface = document.createElement("div");
  surface.innerHTML = `
    <svg viewBox="0 0 360 180" width="360" height="180">
      <g class="node default" id="flowchart-E-319" data-id="E" transform="translate(180, 80)">
        <rect x="-60" y="-30" width="120" height="60"></rect>
        <text x="0" y="6">用户下一步做什么</text>
      </g>
    </svg>
  `;
  const svg = surface.querySelector<SVGSVGElement>("svg");
  if (!svg) {
    throw new Error("runtime svg not rendered");
  }
  const node = svg.querySelector<SVGGElement>("g.node[data-id='E']");
  if (!node) {
    throw new Error("runtime node not rendered");
  }
  stubGraphicsBox(node, { x: -60, y: -30, width: 120, height: 60 }, { a: 1, b: 0, c: 0, d: 1, e: 180, f: 80 });
  stubSurfaceRect(surface);
  return { surface, svg };
}

function renderTranslatedRectSurface(): { surface: HTMLElement; svg: SVGSVGElement } {
  const surface = document.createElement("div");
  surface.innerHTML = `
    <svg viewBox="0 0 700 900" width="700" height="900">
      <g class="node default" data-id="C" transform="translate(323, 247.5)">
        <rect x="-114.25" y="-29.5" width="228.5" height="59"></rect>
        <text x="0" y="-4">汇总所有 Workflow</text>
        <text x="0" y="18">listWorkspaceAutomations()</text>
      </g>
    </svg>
  `;
  const svg = surface.querySelector<SVGSVGElement>("svg");
  if (!svg) {
    throw new Error("translated rect svg not rendered");
  }
  stubSurfaceRect(surface);
  return { surface, svg };
}

function renderTranslatedPolygonSurface(): { surface: HTMLElement; svg: SVGSVGElement } {
  const surface = document.createElement("div");
  surface.innerHTML = `
    <svg viewBox="0 0 700 900" width="700" height="900">
      <g class="node default" data-id="E" transform="translate(323, 526)">
        <polygon points="0,-78 126,0 0,78 -126,0"></polygon>
        <text x="0" y="6">用户下一步做什么</text>
      </g>
    </svg>
  `;
  const svg = surface.querySelector<SVGSVGElement>("svg");
  if (!svg) {
    throw new Error("translated polygon svg not rendered");
  }
  stubSurfaceRect(surface);
  return { surface, svg };
}

function renderTranslatedRectSurfaceWithIdentityMatrix(): { surface: HTMLElement; svg: SVGSVGElement } {
  const rendered = renderTranslatedRectSurface();
  const node = rendered.svg.querySelector<SVGGElement>("g.node[data-id='C']");
  if (!node) {
    throw new Error("translated rect node not rendered");
  }
  node.getCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) as SVGMatrix;
  return rendered;
}

function stubSurfaceRect(surface: HTMLElement): void {
  surface.getBoundingClientRect = () => ({
    x: 50,
    y: 50,
    left: 50,
    top: 50,
    right: 450,
    bottom: 290,
    width: 400,
    height: 240,
    toJSON() {
      return {};
    },
  } as DOMRect);
}

function stubGraphicsBox(
  element: SVGGraphicsElement,
  box: { x: number; y: number; width: number; height: number },
  matrix: { a: number; b: number; c: number; d: number; e: number; f: number },
): void {
  element.getBBox = () => box as DOMRect;
  element.getCTM = () => matrix as SVGMatrix;
}
