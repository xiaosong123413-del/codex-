/**
 * Thin Mermaid runtime wrapper for automation detail rendering.
 *
 * The page layer should not import third-party Mermaid APIs directly. This
 * keeps the rendering contract local and easy to mock in tests.
 */

import mermaid from "mermaid";

let mermaidInitialized = false;

export async function renderMermaidSvg(renderId: string, source: string): Promise<string> {
  initializeMermaidOnce();
  const { svg } = await mermaid.render(renderId, source);
  return svg;
}

function initializeMermaidOnce(): void {
  if (mermaidInitialized) {
    return;
  }
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "base",
    fontFamily: "Inter, 'Noto Sans SC', 'Microsoft YaHei UI', sans-serif",
    themeVariables: {
      primaryColor: "#ffffff",
      primaryBorderColor: "#a2a9b1",
      primaryTextColor: "#202122",
      lineColor: "#a2a9b1",
      tertiaryColor: "#f8f9fa",
    },
  });
  mermaidInitialized = true;
}
