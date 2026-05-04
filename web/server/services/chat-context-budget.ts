/**
 * Chat context budget allocator.
 *
 * Mirrors the legacy retrieval prompt packing math: reserve answer room, keep
 * a small index slice, and cap retrieved page content proportionally instead
 * of sending every search hit verbatim.
 */

interface ContextBudget {
  maxCtx: number;
  responseReserve: number;
  indexBudget: number;
  pageBudget: number;
  maxPageSize: number;
}

const DEFAULT_MAX_CTX = 204_800;
const RESPONSE_RESERVE_FRAC = 0.15;
const INDEX_BUDGET_FRAC = 0.05;
const PAGE_BUDGET_FRAC = 0.5;
const PER_PAGE_FRAC = 0.3;
const PER_PAGE_FLOOR = 5_000;

/** Computes character budgets from an optional model context size. */
export function computeContextBudget(maxContextSize: number | undefined): ContextBudget {
  const maxCtx = typeof maxContextSize === "number" && maxContextSize > 0 ? maxContextSize : DEFAULT_MAX_CTX;
  const responseReserve = Math.floor(maxCtx * RESPONSE_RESERVE_FRAC);
  const indexBudget = Math.floor(maxCtx * INDEX_BUDGET_FRAC);
  const pageBudget = Math.floor(maxCtx * PAGE_BUDGET_FRAC);
  return {
    maxCtx,
    responseReserve,
    indexBudget,
    pageBudget,
    maxPageSize: Math.min(pageBudget, Math.max(PER_PAGE_FLOOR, Math.floor(pageBudget * PER_PAGE_FRAC))),
  };
}
