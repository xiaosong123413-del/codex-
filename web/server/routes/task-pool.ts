/**
 * Task-pool API routes.
 *
 * Keeps task-pool-specific actions out of the older task-plan route file. The
 * shared task-plan state remains the persistence boundary, but candidate
 * generation is exposed as its own task-pool action.
 */
import type { Express, Response } from "express";
import type { ServerConfig } from "../config.js";
import {
  generateTaskPoolCandidates,
  type GenerateTaskPoolCandidatesResult,
} from "../services/task-pool-generation-service.js";
import type { TaskPlanStoreOptions } from "../services/task-plan-store.js";
import type { LLMProvider } from "../../../src/utils/provider.js";

interface TaskPoolRouteOptions extends TaskPlanStoreOptions {
  provider?: LLMProvider;
}

export function registerTaskPoolRoutes(
  app: Express,
  cfg: ServerConfig,
  options: TaskPoolRouteOptions = {},
): void {
  app.post("/api/task-plan/pool/generate", async (_req, res) => {
    try {
      const result = await generateTaskPoolCandidates({
        projectRoot: cfg.projectRoot,
        wikiRoot: cfg.sourceVaultRoot,
        storageRoot: options.storageRoot,
        provider: options.provider,
      });
      respondWithGeneration(res, result);
    } catch (error) {
      respondWithTaskPoolError(res, error);
    }
  });
}

function respondWithGeneration(res: Response, result: GenerateTaskPoolCandidatesResult): void {
  res.json({
    success: true,
    data: {
      state: result.state,
      generationRecord: result.generationRecord,
    },
  });
}

// fallow-ignore-next-line complexity
function respondWithTaskPoolError(res: Response, error: unknown): void {
  const status = error instanceof Error && "statusCode" in error
    ? Number((error as { statusCode?: number }).statusCode) || 500
    : 500;
  res.status(status).json({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
