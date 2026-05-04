/**
 * Lucide-derived icon renderer.
 *
 * Returns inline SVG markup for a named icon. Icons below are copied from the
 * Lucide icon set (MIT License, https://lucide.dev). Extend ICONS as later
 * phases need more; ICON_NAMES is exported for test coverage.
 *
 * Consumers embed the result via `element.innerHTML = renderIcon(name)`.
 * Default size 20, default stroke-width 1.75, matching the visual system.
 */

interface IconOptions {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

const DEFAULT_SIZE = 20;
const DEFAULT_STROKE_WIDTH = 1.75;

/** Inner paths only — the outer <svg> is generated in renderIcon. */
const ICONS: Record<string, string> = {
  "message-square":
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  rss:
    '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
  "check-circle-2":
    '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  "refresh-cw":
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>' +
    '<path d="M21 3v5h-5"/>' +
    '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>' +
    '<path d="M8 16H3v5"/>',
  "clipboard-list":
    '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>' +
    '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>' +
    '<path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  "settings":
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>' +
    '<circle cx="12" cy="12" r="3"/>',
  "search":
    '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  "plus":
    '<path d="M5 12h14"/><path d="M12 5v14"/>',
  "trash-2":
    '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
    '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>' +
    '<path d="M10 11v6"/><path d="M14 11v6"/>',
  "chevron-left":
    '<path d="m15 18-6-6 6-6"/>',
  "chevron-right":
    '<path d="m9 18 6-6-6-6"/>',
  "list-checks":
    '<path d="M3 17h6"/><path d="M3 12h6"/><path d="M3 7h6"/><path d="m13 6 2 2 4-4"/><path d="m13 11 2 2 4-4"/><path d="m13 16 2 2 4-4"/>',
  list:
    '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  pilcrow:
    '<path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/>',
  "heading-2":
    '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6a2 2 0 0 0-4 0"/>',
  quote:
    '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h2c0 3-1 4-3 4z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h2c0 3-1 4-3 4z"/>',
  "square-code":
    '<path d="M10 9 8 12l2 3"/><path d="m14 15 2-3-2-3"/><rect width="18" height="18" x="3" y="3" rx="2"/>',
  link:
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  image:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  "copy":
    '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  "globe":
    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  "external-link":
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  cloud:
    '<path d="M20 17.5a4.5 4.5 0 0 0-1.5-8.74A6 6 0 0 0 7.1 7.6 4 4 0 0 0 6 15h13a3 3 0 0 0 1-7"/>',
  "wikipedia-w":
    '<text x="12" y="17" text-anchor="middle" font-family="Georgia, serif" font-size="15" font-weight="700" fill="currentColor" stroke="none">W</text>' +
    '<circle cx="12" cy="12" r="10"/>',
  "book-open-text":
    '<path d="M12 7v14"/><path d="M3 18a2 2 0 0 1 2-2h7"/><path d="M21 18a2 2 0 0 0-2-2h-7"/><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4H12v14H7.5A2.5 2.5 0 0 0 5 20.5z"/><path d="M19 6.5A2.5 2.5 0 0 0 16.5 4H12v14h4.5A2.5 2.5 0 0 1 19 20.5z"/><path d="M8 8h2"/><path d="M8 11h2"/>',
  "folder-open":
    '<path d="m6 14 2-8h12a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.5a2 2 0 0 1 1.6.8L14 6"/>' +
    '<path d="M2 14h20"/>',
  archive:
    '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8h14v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z"/><path d="M10 12h4"/>',
  "hammer":
    '<path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/>' +
    '<path d="m18 15 4-4"/>' +
    '<path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/>',
  "x":
    '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

export const ICON_NAMES: readonly string[] = Object.keys(ICONS);

export function renderIcon(name: string, options: IconOptions = {}): string {
  const inner = ICONS[name];
  if (!inner) {
    throw new Error(`unknown icon: ${name}`);
  }
  const size = options.size ?? DEFAULT_SIZE;
  const stroke = options.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  const className = options.className ? `lucide-icon ${options.className}` : "lucide-icon";
  return (
    `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" ` +
    `width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="currentColor" stroke-width="${stroke}" ` +
    `stroke-linecap="round" stroke-linejoin="round">` +
    inner +
    `</svg>`
  );
}
