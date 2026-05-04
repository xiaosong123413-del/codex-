/**
 * Cloudflare Pages `/api/search` endpoint for the hosted wiki.
 *
 * The desktop wiki page only needs the local search bucket for its search
 * results view, so this function maps D1 LIKE matches into that response
 * contract without adding a second remote search implementation.
 */
import { json, requireDb } from "../_lib/store.js";
import { searchWikiPages } from "../_lib/wiki.js";

export async function onRequestGet(context) {
  const missing = requireDb(context.env);
  if (missing) return missing;
  const url = new URL(context.request.url);
  const query = url.searchParams.get("q") || "";
  const results = await searchWikiPages(context.env.DB, query);
  return json({
    success: true,
    data: {
      local: { results },
      vector: { results: [] },
      web: { results: [], ok: false, error: "" },
      meta: { query, mode: "keyword", scope: "local" },
    },
  });
}
