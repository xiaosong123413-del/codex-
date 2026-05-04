interface LinkPreviewRequest {
  url?: unknown;
}

interface MobileLinkPreview {
  sourceUrl: string;
  sourceName: string;
  mediaUrls: string[];
}

interface MobileLinkPreviewEnv {
  MEDIA_BUCKET?: MediaBucket;
  PUBLIC_MEDIA_BASE_URL?: string;
}

interface MediaBucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

type WorkerFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const MAX_HTML_CHARS = 600_000;
const MEDIA_META_NAMES = [
  "og:image",
  "og:image:url",
  "og:image:secure_url",
  "twitter:image",
  "twitter:image:src",
  "og:video",
  "og:video:url",
  "og:video:secure_url",
  "twitter:player:stream",
] as const;
const TITLE_META_NAMES = ["og:title", "twitter:title"] as const;
const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export async function handleMobileLinkPreview(
  request: Request,
  env: MobileLinkPreviewEnv = {},
  fetchImpl: WorkerFetch = fetch,
): Promise<Response> {
  const payload = await safeJson<LinkPreviewRequest>(request);
  const sourceUrl = normalizeHttpUrl(payload.url);
  if (!sourceUrl) {
    return json({ ok: false, error: "invalid_link_preview_url" }, 400);
  }

  let upstream: Response;
  try {
    upstream = await fetchImpl(sourceUrl, {
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
        referer: platformReferer(sourceUrl),
        "user-agent": userAgentForPlatform(sourceUrl),
      },
    });
  } catch {
    return json({ ok: false, error: "link_preview_fetch_failed" }, 502);
  }

  const finalUrl = upstream.url || sourceUrl;
  if (!upstream.ok) {
    return json({ ok: false, error: `link_preview_fetch_failed:${upstream.status}` }, 502);
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (/^(image|video)\//i.test(contentType)) {
    const preview = await cachePreviewMedia({
      sourceUrl: finalUrl,
      sourceName: hostnameTitle(finalUrl),
      mediaUrls: [finalUrl],
    }, env, request, finalUrl, fetchImpl);
    return json({
      ok: true,
      preview,
    });
  }

  const html = (await upstream.text()).slice(0, MAX_HTML_CHARS);
  const preview = await cachePreviewMedia(
    parseSocialLinkPreviewHtml(finalUrl, html),
    env,
    request,
    sourceUrl,
    fetchImpl,
  );
  return json({
    ok: true,
    preview,
  });
}

function parseSocialLinkPreviewHtml(sourceUrl: string, html: string): MobileLinkPreview {
  const sourceName = firstMetaContent(html, TITLE_META_NAMES) || titleTagContent(html) || hostnameTitle(sourceUrl);
  const extractedMediaUrls = uniqueMediaUrls([
    ...MEDIA_META_NAMES
      .map((name) => firstMetaContent(html, [name]))
      .filter((value): value is string => Boolean(value))
      .map((value) => normalizeUrl(value, sourceUrl))
      .filter((value): value is string => Boolean(value)),
    ...extractEmbeddedMediaUrls(html, sourceUrl),
  ]);
  const mediaUrls = isDouyinSourceUrl(sourceUrl) ? pickDouyinMediaUrls(extractedMediaUrls) : extractedMediaUrls;

  return {
    sourceUrl,
    sourceName,
    mediaUrls,
  };
}

function firstMetaContent(html: string, names: readonly string[]): string {
  for (const attributes of metaAttributes(html)) {
    const key = attributes.property || attributes.name;
    if (!key || !names.includes(key.toLowerCase())) {
      continue;
    }
    const content = attributes.content?.trim();
    if (content) {
      return decodeHtmlEntities(content);
    }
  }
  return "";
}

function metaAttributes(html: string): Array<Record<string, string>> {
  const attributes: Array<Record<string, string>> = [];
  const matches = html.matchAll(/<meta\b[^>]*>/gi);
  for (const match of matches) {
    attributes.push(parseAttributes(match[0]));
  }
  return attributes;
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const matches = tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g);
  for (const match of matches) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function titleTagContent(html: string): string {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeHtmlEntities(stripTags(match[1]).trim()) : "";
}

function extractEmbeddedMediaUrls(html: string, baseUrl: string): string[] {
  const decodedHtml = decodeHtmlEntities(html)
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\\//g, "/");
  const matches = decodedHtml.matchAll(/https?:\/\/[^\s"'<>\\);{}]+/gi);
  const urls: string[] = [];
  for (const match of matches) {
    const normalized = normalizeUrl(match[0], baseUrl);
    if (normalized && isMediaUrl(normalized)) {
      urls.push(normalized);
    }
  }
  return urls;
}

function isMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const pathname = url.pathname.toLowerCase();
    if (isStaticAssetUrl(url)) {
      return false;
    }
    return /\.(?:avif|gif|jpe?g|m3u8|m4v|mov|mp4|png|webp)$/i.test(pathname)
      || isKnownDouyinVideoUrl(url)
      || isKnownSocialMediaUrl(url);
  } catch {
    return false;
  }
}

// fallow-ignore-next-line complexity
function isStaticAssetUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  return pathname === "/" || pathname === ""
    || /\.(?:css|ico|js|json|map|pdf|svg|woff2?)$/i.test(pathname)
    || hostname.startsWith("fe-static.")
    || hostname.startsWith("sns-avatar")
    || hostname.startsWith("picasso-static.")
    || pathname.includes("/fe-platform/")
    || pathname.includes("favicon")
    || pathname.includes("logo")
    || pathname.includes("hot-icon");
}

function isKnownSocialMediaUrl(url: URL): boolean {
  return isKnownSocialMediaHostname(url.hostname);
}

function isKnownDouyinVideoUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  return hostname === "aweme.snssdk.com" && pathname.startsWith("/aweme/v1/play");
}

function isKnownSocialMediaHostname(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();
  return lowerHostname.startsWith("sns-webpic")
    || lowerHostname.startsWith("sns-img")
    || lowerHostname.startsWith("sns-video")
    || lowerHostname.startsWith("sns-bak")
    || lowerHostname.includes("douyinpic.com")
    || lowerHostname.includes("douyinvod.com")
    || lowerHostname.includes("byteimg.com");
}

function normalizeUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(decodeHtmlEntities(value.trim()), baseUrl);
    if (url.protocol === "http:" && isKnownSocialMediaHostname(url.hostname)) {
      url.protocol = "https:";
    }
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function platformReferer(sourceUrl: string): string {
  const hostname = new URL(sourceUrl).hostname.toLowerCase();
  if (hostname.includes("douyin.com") || hostname.includes("iesdouyin.com") || hostname.includes("amemv.com")) {
    return "https://www.douyin.com/";
  }
  if (hostname.includes("xhslink.com") || hostname.includes("xiaohongshu.com")) {
    return "https://www.xiaohongshu.com/";
  }
  return new URL(sourceUrl).origin + "/";
}

function isDouyinSourceUrl(sourceUrl: string): boolean {
  const hostname = new URL(sourceUrl).hostname.toLowerCase();
  return hostname.includes("douyin.com") || hostname.includes("iesdouyin.com") || hostname.includes("amemv.com");
}

function pickDouyinMediaUrls(mediaUrls: string[]): string[] {
  const cover = mediaUrls.find(isDouyinCoverUrl) ?? mediaUrls.find(isImageFileUrl);
  const video = mediaUrls.find((value) => {
    try {
      const url = new URL(value);
      return isKnownDouyinVideoUrl(url)
        || url.hostname.toLowerCase().includes("douyinvod.com")
        || /\.(?:m4v|mov|mp4|webm)$/i.test(url.pathname);
    } catch {
      return false;
    }
  });
  return [cover, video].filter((value): value is string => Boolean(value));
}

function isImageFileUrl(value: string): boolean {
  try {
    return /\.(?:avif|gif|jpe?g|png|webp)$/i.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

function isDouyinCoverUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    if (!hostname.includes("douyinpic.com") && !hostname.includes("byteimg.com")) {
      return false;
    }
    if (pathname.includes("aweme-avatar") || pathname.includes("douyin-user-image-file")) {
      return false;
    }
    return pathname.includes("/tos-cn-i-dy/")
      || pathname.includes("cover")
      || url.searchParams.get("sc") === "cover";
  } catch {
    return false;
  }
}

function userAgentForPlatform(sourceUrl: string): string {
  const hostname = new URL(sourceUrl).hostname.toLowerCase();
  if (hostname.includes("xhslink.com") || hostname.includes("xiaohongshu.com")) {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  }
  return USER_AGENT;
}

function hostnameTitle(sourceUrl: string): string {
  return new URL(sourceUrl).hostname;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function cachePreviewMedia(
  preview: MobileLinkPreview,
  env: MobileLinkPreviewEnv,
  request: Request,
  sourceUrl: string,
  fetchImpl: WorkerFetch,
): Promise<MobileLinkPreview> {
  if (!env.MEDIA_BUCKET || preview.mediaUrls.length === 0) {
    return preview;
  }

  const mediaUrls: string[] = [];
  for (const mediaUrl of preview.mediaUrls) {
    const cachedUrl = await cacheMediaUrl(mediaUrl, env, request, sourceUrl, fetchImpl);
    if (cachedUrl) {
      mediaUrls.push(cachedUrl);
    }
  }

  return {
    ...preview,
    mediaUrls,
  };
}

async function cacheMediaUrl(
  mediaUrl: string,
  env: MobileLinkPreviewEnv,
  request: Request,
  sourceUrl: string,
  fetchImpl: WorkerFetch,
): Promise<string | null> {
  if (!env.MEDIA_BUCKET) {
    return null;
  }
  let response: Response;
  try {
    response = await fetchImpl(mediaUrl, {
      redirect: "follow",
      headers: {
        accept: "image/avif,image/webp,image/*,video/*,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
        referer: platformReferer(sourceUrl),
        "user-agent": userAgentForPlatform(sourceUrl),
      },
    });
  } catch {
    return null;
  }
  if (!response.ok || !response.body) {
    return null;
  }

  const contentType = normalizeMediaContentType(response.headers.get("content-type"), mediaUrl);
  if (!contentType) {
    return null;
  }

  const key = `clipping-preview/${await sha256Hex(mediaUrl)}.${extensionForContentType(contentType)}`;
  await env.MEDIA_BUCKET.put(key, response.body, {
    httpMetadata: { contentType },
  });
  return `${publicMediaBaseUrl(env, request)}/media/${encodeMediaKey(key)}`;
}

function normalizeMediaContentType(value: string | null, mediaUrl: string): string | null {
  const contentType = String(value ?? "").split(";")[0].trim().toLowerCase();
  if (/^(image|video)\//.test(contentType)) {
    return contentType;
  }
  return guessMediaContentType(mediaUrl);
}

// fallow-ignore-next-line complexity
function guessMediaContentType(mediaUrl: string): string | null {
  const url = new URL(mediaUrl);
  const pathname = url.pathname.toLowerCase();
  if (isKnownDouyinVideoUrl(url)) return "video/mp4";
  if (pathname.endsWith(".mp4")) return "video/mp4";
  if (pathname.endsWith(".webm")) return "video/webm";
  if (pathname.endsWith(".mov")) return "video/quicktime";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".gif")) return "image/gif";
  if (pathname.endsWith(".avif")) return "image/avif";
  if (pathname.endsWith(".webp") || isKnownSocialMediaUrl(new URL(mediaUrl))) return "image/webp";
  return null;
}

function extensionForContentType(contentType: string): string {
  if (contentType === "video/mp4") return "mp4";
  if (contentType === "video/webm") return "webm";
  if (contentType === "video/quicktime") return "mov";
  if (contentType === "image/png") return "png";
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/gif") return "gif";
  if (contentType === "image/avif") return "avif";
  return "webp";
}

function publicMediaBaseUrl(env: MobileLinkPreviewEnv, request: Request): string {
  return String(env.PUBLIC_MEDIA_BASE_URL || new URL(request.url).origin).replace(/\/+$/, "");
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function encodeMediaKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function uniqueMediaUrls(values: string[]): string[] {
  const seen = new Set<string>();
  const mediaUrls: string[] = [];
  for (const value of values) {
    const key = mediaDedupeKey(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    mediaUrls.push(value);
  }
  return mediaUrls;
}

function mediaDedupeKey(value: string): string {
  try {
    const url = new URL(value);
    const xiaohongshuKey = xiaohongshuMediaDedupeKey(url);
    if (xiaohongshuKey) {
      return xiaohongshuKey;
    }
    return url.toString();
  } catch {
    return value;
  }
}

function xiaohongshuMediaDedupeKey(url: URL): string | null {
  if (!url.hostname.toLowerCase().includes("xhscdn.com")) {
    return null;
  }
  const pathname = url.pathname;
  const assetName = pathname.split("/").filter(Boolean).pop() ?? "";
  const normalizedAssetName = assetName.split("!")[0].toLowerCase();
  if (!normalizedAssetName) {
    return null;
  }
  if (/\.mp4$/i.test(normalizedAssetName)) {
    return `xhs-video:${normalizedAssetName}`;
  }
  if (url.hostname.toLowerCase().startsWith("sns-webpic") || url.hostname.toLowerCase().startsWith("sns-img")) {
    return `xhs-image:${normalizedAssetName}`;
  }
  return null;
}

async function safeJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    return {} as T;
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
