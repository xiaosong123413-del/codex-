/**
 * Current published wiki state for the hosted Pages wiki.
 *
 * The public wiki uses this lightweight endpoint to detect remote publish
 * changes without re-fetching the full current page or tree on every poll.
 */
import { json, requireDb } from "../_lib/store.js";

export async function onRequestGet(context) {
  const missing = requireDb(context.env);
  if (missing) return missing;

  const row = await context.env.DB.prepare(
    "SELECT publish_version AS publishVersion, published_at AS publishedAt, file_count AS fileCount FROM publish_runs WHERE action = 'publish' AND status = 'published' ORDER BY published_at DESC LIMIT 1",
  ).bind().first();

  return json({
    success: true,
    data: {
      publishVersion: String(row?.publishVersion ?? ""),
      publishedAt: String(row?.publishedAt ?? ""),
      fileCount: Number(row?.fileCount ?? 0),
    },
  });
}
