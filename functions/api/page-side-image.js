/**
 * Hosted wiki side-image endpoint.
 *
 * Remote wiki pages may reference absolute image URLs in frontmatter. Local
 * filesystem image paths cannot be served by Cloudflare Pages, so unsupported
 * paths return a clear 404 instead of falling through to the SPA document.
 */

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const imagePath = String(url.searchParams.get("path") || "").trim();
  if (/^https?:\/\//iu.test(imagePath)) {
    return Response.redirect(imagePath, 302);
  }
  return new Response("image_not_available", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
