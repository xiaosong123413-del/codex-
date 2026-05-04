/**
 * Cloudflare Pages `/api/page` endpoint for the hosted wiki.
 *
 * The desktop wiki renderer expects this route to return rendered article HTML
 * plus the original Markdown. The data source here is the published
 * `wiki_pages` table written by the Cloudflare wiki publish step.
 */
import { json, requireDb } from "../_lib/store.js";
import { readWikiPage } from "../_lib/wiki.js";

export async function onRequestGet(context) {
  const missing = requireDb(context.env);
  if (missing) return missing;
  const url = new URL(context.request.url);
  const page = await readWikiPage(context.env.DB, url.searchParams.get("path"));
  if (!page) {
    return json({ success: false, error: "page_not_found" }, 404);
  }
  return json(page);
}
