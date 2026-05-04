/**
 * Shared client-side types for the editable identity dashboard.
 */

export type IdentityWidgetType =
  | "hero"
  | "stage"
  | "timeline"
  | "nav"
  | "relations"
  | "dreams"
  | "health"
  | "mood"
  | "goals"
  | "metaphysics"
  | "text"
  | "table"
  | "list";

IdentityWidgetSourceKind = "manual" | "ai" | "sync";

export interface IdentityDashboardLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface IdentityWidgetSource {
  kind: IdentityWidgetSourceKind;
  note: string;
  path?: string;
  updatedAt?: string;
}

export interface IdentityDashboardWidget {
  id: string;
  type: IdentityWidgetType;
  title: string;
  enabled: boolean;
  layout: IdentityDashboardLayout;
  data: Record<string, unknown>;
  source: IdentityWidgetSource;
}

export interface IdentityDashboardConfig {
  version: 1;
  sourcePath: string;
  widgets: IdentityDashboardWidget[];
}

export interface IdentityInfoPageResponse {
  path: string;
  title: string | null;
  frontmatter?: Record<string, unknown> | null;
  raw?: string;
  modifiedAt?: string;
}

export interface IdentityInfoDocument {
  title: string;
  basic: Record<string, string>;
  education: Record<string, string>;
  contact: Record<string, string>;
  publicIdentity: Record<string, string>;
  tags: string[];
  timeline: IdentityTimelineItem[];
  rules: string[];
}

export interface IdentityTimelineItem {
  date: string;
  fact: string;
}
