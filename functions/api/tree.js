/**
 * Cloudflare Pages `/api/tree` endpoint for the hosted wiki.
 *
 * It exposes the same lightweight tree shape as the desktop WebUI so the
 * Peiweipedia sidebar and home page can render from the remote D1 mirror.
 */
import { json, requireDb } from "../_lib/store.js";
import { readWikiTree } from "../_lib/wiki.js";

export async function onRequestGet(context) {
  const missing = requireDb(context.env);
  if (missing) return missing;
  const tree = await readWikiTree(context.env.DB);
  return json(tree);
}
