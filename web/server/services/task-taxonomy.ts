/**
 * Shared domain/project option store for task-related surfaces.
 *
 * The task pool already carries `domain` and `project` on its items. Personal
 * timeline entries need to use the same vocabulary, including categories created
 * by either workflow. This small store merges task-pool state with an explicit
 * taxonomy sidecar for timeline-discovered options.
 */

import fs from "node:fs";
import path from "node:path";

interface StoredTaskPlanState {
  pool?: {
    items?: Array<{
      domain?: unknown;
      project?: unknown;
    }>;
  };
}

interface StoredTaskTaxonomy {
  domains?: unknown;
  projects?: unknown;
}

interface TaskTaxonomyProject {
  domain: string;
  name: string;
}

export interface TaskTaxonomy {
  domains: string[];
  projects: TaskTaxonomyProject[];
}

const TAXONOMY_FILE_NAME = "taxonomy.json";
const TASK_PLAN_DIR_NAME = "task plan";
const STATE_FILE_NAME = "state.json";
const EMPTY_TAXONOMY: TaskTaxonomy = { domains: [], projects: [] };

export function readSharedTaskTaxonomy(sourceVaultRoot: string, storageRoot?: string): TaskTaxonomy {
  const root = storageRoot ?? taskPlanStorageRoot(sourceVaultRoot);
  return mergeTaxonomies(readStoredTaxonomy(root), readTaskPoolTaxonomy(root));
}

export function registerSharedTaskTaxonomy(
  sourceVaultRoot: string,
  input: TaskTaxonomyProject,
  storageRoot?: string,
): void {
  const project = normalizeProject(input);
  if (!project) return;
  const root = storageRoot ?? taskPlanStorageRoot(sourceVaultRoot);
  const current = readStoredTaxonomy(root);
  const next = mergeTaxonomies(current, {
    domains: [project.domain],
    projects: [project],
  });
  writeStoredTaxonomy(root, next);
}

function taskPlanStorageRoot(sourceVaultRoot: string): string {
  return path.join(sourceVaultRoot, TASK_PLAN_DIR_NAME);
}

function readTaskPoolTaxonomy(storageRoot: string): TaskTaxonomy {
  const filePath = path.join(storageRoot, STATE_FILE_NAME);
  if (!fs.existsSync(filePath)) return EMPTY_TAXONOMY;
  try {
    const state = JSON.parse(fs.readFileSync(filePath, "utf8")) as StoredTaskPlanState;
    return taskPoolTaxonomyFromItems(state.pool?.items ?? []);
  } catch {
    return EMPTY_TAXONOMY;
  }
}

function readStoredTaxonomy(storageRoot: string): TaskTaxonomy {
  const filePath = path.join(storageRoot, TAXONOMY_FILE_NAME);
  if (!fs.existsSync(filePath)) return EMPTY_TAXONOMY;
  try {
    return normalizeStoredTaxonomy(JSON.parse(fs.readFileSync(filePath, "utf8")) as StoredTaskTaxonomy);
  } catch {
    return EMPTY_TAXONOMY;
  }
}

function taskPoolTaxonomyFromItems(items: NonNullable<StoredTaskPlanState["pool"]>["items"]): TaskTaxonomy {
  const projects = (items ?? []).flatMap((item) => {
    const domain = normalizeOption(item.domain);
    const name = normalizeOption(item.project);
    return domain && name ? [{ domain, name }] : [];
  });
  const domains = (items ?? []).flatMap((item) => {
    const domain = normalizeOption(item.domain);
    return domain ? [domain] : [];
  });
  return mergeTaxonomies({ domains, projects }, EMPTY_TAXONOMY);
}

function normalizeStoredTaxonomy(input: StoredTaskTaxonomy): TaskTaxonomy {
  const domains = Array.isArray(input.domains) ? input.domains.map(normalizeOption).filter(isText) : [];
  const projects = Array.isArray(input.projects) ? input.projects.map(normalizeStoredProject).filter(isProject) : [];
  return mergeTaxonomies({ domains, projects }, EMPTY_TAXONOMY);
}

function normalizeStoredProject(input: unknown): TaskTaxonomyProject | null {
  if (!input || typeof input !== "object") return null;
  const record = input as { domain?: unknown; name?: unknown };
  return normalizeProject({ domain: normalizeOption(record.domain) ?? "", name: normalizeOption(record.name) ?? "" });
}

function normalizeProject(input: TaskTaxonomyProject): TaskTaxonomyProject | null {
  const domain = normalizeOption(input.domain);
  const name = normalizeOption(input.name);
  return domain && name && domain !== "—" && name !== "—" ? { domain, name } : null;
}

function mergeTaxonomies(left: TaskTaxonomy, right: TaskTaxonomy): TaskTaxonomy {
  const domains = uniqueText([...left.domains, ...right.domains]);
  const projects = uniqueProjects([...left.projects, ...right.projects]);
  return { domains, projects };
}

function uniqueText(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeOption).filter(isText)));
}

function uniqueProjects(projects: TaskTaxonomyProject[]): TaskTaxonomyProject[] {
  const seen = new Set<string>();
  return projects.flatMap((project) => {
    const normalized = normalizeProject(project);
    if (!normalized) return [];
    const key = `${normalized.domain}\0${normalized.name}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

function writeStoredTaxonomy(storageRoot: string, taxonomy: TaskTaxonomy): void {
  fs.mkdirSync(storageRoot, { recursive: true });
  fs.writeFileSync(path.join(storageRoot, TAXONOMY_FILE_NAME), `${JSON.stringify(taxonomy, null, 2)}\n`, "utf8");
}

function normalizeOption(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isText(value: string | null): value is string {
  return Boolean(value);
}

function isProject(value: TaskTaxonomyProject | null): value is TaskTaxonomyProject {
  return value !== null;
}
