/**
 * Owns the desktop workspace identity contract.
 *
 * A user-selected sync location must declare which account owns it before the
 * desktop shell starts reading or writing wiki data. This keeps the current
 * local account boundary explicit while future email/phone login can map to the
 * same owner identifier.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const WORKSPACE_METADATA_RELATIVE_PATH = path.join(".llmwiki", "workspace.json");
const WORKSPACE_SCHEMA_VERSION = 1;

export interface WorkspaceMetadata {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  workspaceId: string;
  ownerUserId: string;
  createdAt: string;
}

type WorkspaceBindingResult =
  | { ok: true; created: boolean; metadata: WorkspaceMetadata }
  | { ok: false; error: string };

type WorkspaceMetadataRead =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "found"; metadata: WorkspaceMetadata };

export function normalizeOwnerUserId(value: string): string {
  return value.trim().toLowerCase();
}

export function ensureWorkspaceBinding(
  workspaceRoot: string,
  ownerUserId: string,
  now = new Date(),
  createWorkspaceId: () => string = randomUUID,
): WorkspaceBindingResult {
  const normalizedOwner = normalizeOwnerUserId(ownerUserId);
  if (!normalizedOwner) {
    return { ok: false, error: "Account identifier is required." };
  }

  const metadataPath = getWorkspaceMetadataPath(workspaceRoot);
  const existing = readWorkspaceMetadata(metadataPath);
  if (existing.status === "invalid") {
    return { ok: false, error: `Workspace metadata is invalid: ${metadataPath}` };
  }
  if (existing.status === "found") {
    return validateWorkspaceOwner(existing.metadata, normalizedOwner);
  }

  return createWorkspaceMetadata(metadataPath, normalizedOwner, now, createWorkspaceId);
}

function getWorkspaceMetadataPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, WORKSPACE_METADATA_RELATIVE_PATH);
}

function createWorkspaceMetadata(
  metadataPath: string,
  ownerUserId: string,
  now: Date,
  createWorkspaceId: () => string,
): WorkspaceBindingResult {
  const metadata: WorkspaceMetadata = {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    workspaceId: createWorkspaceId(),
    ownerUserId,
    createdAt: now.toISOString(),
  };
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return { ok: true, created: true, metadata };
}

function readWorkspaceMetadata(metadataPath: string): WorkspaceMetadataRead {
  if (!fs.existsSync(metadataPath)) {
    return { status: "missing" };
  }
  try {
    const raw = fs.readFileSync(metadataPath, "utf8").replace(/^\uFEFF/, "");
    const metadata = parseWorkspaceMetadata(JSON.parse(raw) as unknown);
    return metadata ? { status: "found", metadata } : { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
}

function parseWorkspaceMetadata(value: unknown): WorkspaceMetadata | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    return null;
  }
  if (!isNonEmptyText(record.workspaceId) || !isNonEmptyText(record.ownerUserId)) {
    return null;
  }
  if (!isNonEmptyText(record.createdAt)) {
    return null;
  }
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    workspaceId: record.workspaceId,
    ownerUserId: normalizeOwnerUserId(record.ownerUserId),
    createdAt: record.createdAt,
  };
}

function validateWorkspaceOwner(
  metadata: WorkspaceMetadata,
  ownerUserId: string,
): WorkspaceBindingResult {
  if (metadata.ownerUserId !== ownerUserId) {
    return {
      ok: false,
      error: `This workspace belongs to another account: ${metadata.ownerUserId}`,
    };
  }
  return { ok: true, created: false, metadata };
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
