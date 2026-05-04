/**
 * Runtime store for code-flow potential destinations.
 *
 * Potential destinations are local, project-bound annotations that explain
 * intended downstream uses beyond the source-audited graph. They stay in the
 * runtime root and do not mutate repository-tracked workflow definitions.
 */

import fs from "node:fs";
import path from "node:path";

const STORE_DIR = ".llmwiki";
const POTENTIAL_DESTINATIONS_FILE = "automation-potential-destinations.json";

export interface AutomationPotentialDestinationRecord {
  id: string;
  automationId: string;
  nodeId: string;
  label: string;
  intendedOutcome: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

interface PotentialDestinationsStore {
  itemsByAutomationId: Record<string, Record<string, AutomationPotentialDestinationRecord[]>>;
}

type AutomationPotentialDestinationPatch = Partial<Pick<
  AutomationPotentialDestinationRecord,
  "label" | "intendedOutcome" | "note"
>>;

export function listAutomationPotentialDestinations(
  runtimeRoot: string,
  automationId: string,
  nodeId: string,
): AutomationPotentialDestinationRecord[] {
  const store = readPotentialDestinationsStore(runtimeRoot);
  return [...(store.itemsByAutomationId[automationId]?.[nodeId] ?? [])]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function createAutomationPotentialDestination(
  runtimeRoot: string,
  automationId: string,
  nodeId: string,
  input: Pick<AutomationPotentialDestinationRecord, "label" | "intendedOutcome" | "note">,
  now: Date = new Date(),
): AutomationPotentialDestinationRecord {
  const timestamp = now.toISOString();
  const store = readPotentialDestinationsStore(runtimeRoot);
  const next: AutomationPotentialDestinationRecord = {
    id: `automation-potential-${now.getTime()}-${Math.random().toString(16).slice(2, 10)}`,
    automationId,
    nodeId,
    label: input.label,
    intendedOutcome: input.intendedOutcome,
    note: input.note,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const itemsByNodeId = store.itemsByAutomationId[automationId] ?? {};
  const items = itemsByNodeId[nodeId] ?? [];
  items.push(next);
  itemsByNodeId[nodeId] = items;
  store.itemsByAutomationId[automationId] = itemsByNodeId;
  writeJson(storePath(runtimeRoot, POTENTIAL_DESTINATIONS_FILE), store);
  return next;
}

export function updateAutomationPotentialDestination(
  runtimeRoot: string,
  automationId: string,
  potentialId: string,
  input: AutomationPotentialDestinationPatch,
  now: Date = new Date(),
): AutomationPotentialDestinationRecord | null {
  const store = readPotentialDestinationsStore(runtimeRoot);
  const itemsByNodeId = store.itemsByAutomationId[automationId];
  if (!itemsByNodeId) {
    return null;
  }
  for (const [nodeId, items] of Object.entries(itemsByNodeId)) {
    const index = items.findIndex((item) => item.id === potentialId);
    if (index < 0) {
      continue;
    }
    const updated: AutomationPotentialDestinationRecord = {
      ...items[index]!,
      ...input,
      nodeId,
      updatedAt: now.toISOString(),
    };
    items[index] = updated;
    writeJson(storePath(runtimeRoot, POTENTIAL_DESTINATIONS_FILE), store);
    return updated;
  }
  return null;
}

export function deleteAutomationPotentialDestination(
  runtimeRoot: string,
  automationId: string,
  potentialId: string,
): boolean {
  const store = readPotentialDestinationsStore(runtimeRoot);
  const itemsByNodeId = store.itemsByAutomationId[automationId];
  if (!itemsByNodeId) {
    return false;
  }
  for (const [nodeId, items] of Object.entries(itemsByNodeId)) {
    const next = items.filter((item) => item.id !== potentialId);
    if (next.length === items.length) {
      continue;
    }
    if (next.length === 0) {
      delete itemsByNodeId[nodeId];
    } else {
      itemsByNodeId[nodeId] = next;
    }
    if (Object.keys(itemsByNodeId).length === 0) {
      delete store.itemsByAutomationId[automationId];
    }
    writeJson(storePath(runtimeRoot, POTENTIAL_DESTINATIONS_FILE), store);
    return true;
  }
  return false;
}

function readPotentialDestinationsStore(runtimeRoot: string): PotentialDestinationsStore {
  const parsed = readJson(storePath(runtimeRoot, POTENTIAL_DESTINATIONS_FILE));
  if (!isRecord(parsed) || !isRecord(parsed.itemsByAutomationId)) {
    return { itemsByAutomationId: {} };
  }
  const normalized: PotentialDestinationsStore["itemsByAutomationId"] = {};
  for (const [automationId, itemsByNodeId] of Object.entries(parsed.itemsByAutomationId)) {
    if (!isRecord(itemsByNodeId)) {
      continue;
    }
    normalized[automationId] = {};
    for (const [nodeId, items] of Object.entries(itemsByNodeId)) {
      if (!Array.isArray(items)) {
        continue;
      }
      normalized[automationId][nodeId] = items.flatMap(normalizePotentialDestination);
    }
  }
  return { itemsByAutomationId: normalized };
}

// fallow-ignore-next-line complexity
function normalizePotentialDestination(input: unknown): AutomationPotentialDestinationRecord[] {
  if (!isRecord(input)) {
    return [];
  }
  if (
    typeof input.id !== "string"
    || typeof input.automationId !== "string"
    || typeof input.nodeId !== "string"
    || typeof input.label !== "string"
    || typeof input.intendedOutcome !== "string"
    || typeof input.note !== "string"
    || typeof input.createdAt !== "string"
  ) {
    return [];
  }
  return [{
    id: input.id,
    automationId: input.automationId,
    nodeId: input.nodeId,
    label: input.label,
    intendedOutcome: input.intendedOutcome,
    note: input.note,
    createdAt: input.createdAt,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : input.createdAt,
  }];
}

function readJson(file: string): unknown {
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
}

function storePath(runtimeRoot: string, fileName: string): string {
  return path.join(runtimeRoot, STORE_DIR, fileName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
