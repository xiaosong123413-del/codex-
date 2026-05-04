/**
 * Scheduled diary cover image generation for mobile entries.
 *
 * The phone stores the active image provider in D1. The scheduled Worker reads
 * that provider at 23:30 China time and prepends a generated cover image to the
 * newest diary entry for the day when the day has text but no image.
 */

import type { MobileAiProviderRequest, MobileOwnerPayload } from "./mobile-shared.js";
import { parseStringArray } from "./mobile-shared.js";
import { json, safeJson } from "./worker-support.js";

interface MobileDiaryImageEnv {
  DB?: D1Database;
  MEDIA_BUCKET?: R2Bucket;
  PUBLIC_MEDIA_BASE_URL?: string;
}

interface MobileProviderSavePayload extends MobileOwnerPayload {
  provider?: MobileAiProviderRequest | null;
}

interface MobileDiaryImageGeneratePayload extends MobileOwnerPayload {
  targetDate?: string;
}

interface StoredImageProvider {
  ownerUid: string;
  apiName: string;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}

interface DiaryImageEntryRow {
  id: string;
  text: string;
  mediaFilesJson: string;
  createdAt: string;
}

interface ImageGenerationResponse {
  data?: Array<{
    b64_json?: unknown;
    url?: unknown;
  }>;
  error?: unknown;
  message?: unknown;
}

interface ProviderErrorPayload {
  error?: unknown;
  message?: unknown;
}

type JsonRecord = Record<string, unknown>;

interface GeneratedImage {
  bytes: Uint8Array;
  contentType: string;
}

interface DailyDiaryImageResult {
  ownerCount: number;
  checkedCount: number;
  generatedCount: number;
  skippedCount: number;
}

interface MobileDiaryImageGenerateResult {
  generated: boolean;
  mediaUrl?: string;
  skippedReason?: string;
}

export async function handleMobileProviderSave(request: Request, env: MobileDiaryImageEnv): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const payload = await safeJson<MobileProviderSavePayload>(request);
  const ownerUid = String(payload.ownerUid ?? "").trim();
  if (!ownerUid) return json({ ok: false, error: "missing_owner_uid" }, 400);

  const provider = payload.provider;
  if (!isApiImageProvider(provider)) {
    await db.prepare("DELETE FROM mobile_ai_providers WHERE owner_uid = ?").bind(ownerUid).run();
    return json({ ok: true, enabled: false });
  }

  const apiName = readText(provider.apiName);
  const apiBaseUrl = readText(provider.apiBaseUrl);
  const apiKey = readText(provider.apiKey);
  const model = readText(provider.model);
  await db.prepare(
    "INSERT INTO mobile_ai_providers (owner_uid, mode, api_name, api_base_url, api_key, image_model, updated_at) VALUES (?, 'api', ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(owner_uid) DO UPDATE SET mode = excluded.mode, api_name = excluded.api_name, api_base_url = excluded.api_base_url, api_key = excluded.api_key, image_model = excluded.image_model, updated_at = CURRENT_TIMESTAMP",
  ).bind(ownerUid, apiName, apiBaseUrl, apiKey, model).run();
  return json({ ok: true, enabled: true });
}

export async function handleMobileDiaryImageGenerate(request: Request, env: MobileDiaryImageEnv): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "missing_d1_binding" }, 500);
  if (!env.MEDIA_BUCKET) return json({ ok: false, error: "missing_media_bucket_binding" }, 500);
  if (!readText(env.PUBLIC_MEDIA_BASE_URL)) return json({ ok: false, error: "missing_public_media_base_url" }, 500);

  const payload = await safeJson<MobileDiaryImageGeneratePayload>(request);
  const ownerUid = readText(payload.ownerUid);
  const targetDate = readText(payload.targetDate);
  if (!ownerUid) return json({ ok: false, error: "missing_owner_uid" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return json({ ok: false, error: "missing_target_date" }, 400);

  const provider = await readImageProvider(env.DB, ownerUid);
  if (!provider) return json({ ok: false, error: "missing_image_provider" }, 400);

  try {
    const result = await generateDiaryImageForDate(env, provider, targetDate);
    return json({ ok: true, ...result });
  } catch (error) {
    return json({ ok: false, error: readErrorMessage(error, "AI 配图生成失败") }, 502);
  }
}

export async function writeDailyDiaryImages(
  env: MobileDiaryImageEnv,
  now = new Date(),
): Promise<DailyDiaryImageResult> {
  const result: DailyDiaryImageResult = {
    ownerCount: 0,
    checkedCount: 0,
    generatedCount: 0,
    skippedCount: 0,
  };
  if (!env.DB || !env.MEDIA_BUCKET || !readText(env.PUBLIC_MEDIA_BASE_URL)) {
    return result;
  }

  const providers = await readImageProviders(env.DB);
  result.ownerCount = providers.length;
  const targetDate = formatChinaDate(now);
  for (const provider of providers) {
    result.checkedCount += 1;
    try {
      const generated = await generateDiaryImageForDate(env, provider, targetDate);
      if (generated.generated) result.generatedCount += 1;
      else result.skippedCount += 1;
    } catch (error) {
      console.error("daily_diary_image_failed", provider.ownerUid, error);
      result.skippedCount += 1;
    }
  }
  return result;
}

async function readImageProviders(db: D1Database): Promise<StoredImageProvider[]> {
  const response = await db.prepare(
    "SELECT owner_uid AS ownerUid, api_name AS apiName, api_base_url AS apiBaseUrl, api_key AS apiKey, image_model AS model FROM mobile_ai_providers WHERE mode = 'api' AND image_model <> ''",
  ).all();
  return (response.results ?? []).map((row) => ({
    ownerUid: readText(row.ownerUid),
    apiName: readText(row.apiName),
    apiBaseUrl: readText(row.apiBaseUrl),
    apiKey: readText(row.apiKey),
    model: readText(row.model),
  })).filter((provider) => provider.ownerUid && provider.apiBaseUrl && provider.apiKey && provider.model);
}

async function readImageProvider(db: D1Database, ownerUid: string): Promise<StoredImageProvider | null> {
  const row = await db.prepare(
    "SELECT owner_uid AS ownerUid, api_name AS apiName, api_base_url AS apiBaseUrl, api_key AS apiKey, image_model AS model FROM mobile_ai_providers WHERE owner_uid = ? AND mode = 'api' AND image_model <> ''",
  ).bind(ownerUid).first();
  if (!row) return null;
  const provider = {
    ownerUid: readText(row.ownerUid),
    apiName: readText(row.apiName),
    apiBaseUrl: readText(row.apiBaseUrl),
    apiKey: readText(row.apiKey),
    model: readText(row.model),
  };
  return provider.ownerUid && provider.apiBaseUrl && provider.apiKey && provider.model ? provider : null;
}

async function generateDiaryImageForDate(
  env: MobileDiaryImageEnv,
  provider: StoredImageProvider,
  targetDate: string,
): Promise<MobileDiaryImageGenerateResult> {
  if (!env.DB || !env.MEDIA_BUCKET) return { generated: false, skippedReason: "missing_binding" };
  const entries = await readDiaryEntriesForDate(env.DB, provider.ownerUid, targetDate);
  if (!entries.length) return { generated: false, skippedReason: "no_entries" };
  if (entries.some((entry) => hasImageMedia(parseStringArray(entry.mediaFilesJson)))) {
    return { generated: false, skippedReason: "already_has_image" };
  }
  const diaryText = entries.map((entry) => entry.text.trim()).filter(Boolean).join("\n\n");
  if (!diaryText) return { generated: false, skippedReason: "empty_text" };

  const generatedImage = await generateDiaryImage(provider, diaryText);
  const mediaKey = `generated-diary/${provider.ownerUid}/${targetDate}/${crypto.randomUUID()}.png`;
  await env.MEDIA_BUCKET.put(mediaKey, generatedImage.bytes, {
    httpMetadata: { contentType: generatedImage.contentType },
  });
  const mediaUrl = buildMediaUrl(readText(env.PUBLIC_MEDIA_BASE_URL), mediaKey);
  const latestEntry = entries[0]!;
  const nextMediaFiles = [mediaUrl, ...parseStringArray(latestEntry.mediaFilesJson)];
  await env.DB.prepare(
    "UPDATE mobile_entries SET media_files_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(JSON.stringify(nextMediaFiles), latestEntry.id).run();
  return { generated: true, mediaUrl };
}

async function readDiaryEntriesForDate(
  db: D1Database,
  ownerUid: string,
  targetDate: string,
): Promise<DiaryImageEntryRow[]> {
  const response = await db.prepare(
    "SELECT id, text, media_files_json AS mediaFilesJson, created_at AS createdAt FROM mobile_entries WHERE owner_uid = ? AND type = 'flash_diary' AND target_date = ? ORDER BY created_at DESC LIMIT 50",
  ).bind(ownerUid, targetDate).all();
  return (response.results ?? []).map((row) => ({
    id: readText(row.id),
    text: readText(row.text),
    mediaFilesJson: readText(row.mediaFilesJson) || "[]",
    createdAt: readText(row.createdAt),
  })).filter((entry) => entry.id);
}

// fallow-ignore-next-line complexity
async function generateDiaryImage(provider: StoredImageProvider, diaryText: string): Promise<GeneratedImage> {
  assertProviderApiKey(provider.apiKey);
  if (isGrsaiProvider(provider.apiBaseUrl)) {
    return generateGrsaiDiaryImage(provider, diaryText);
  }
  const response = await fetch(createImagesUrl(provider.apiBaseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      prompt: buildDiaryImagePrompt(diaryText),
      size: "1536x1024",
    }),
  });
  const payload = await response.json().catch(() => ({})) as ImageGenerationResponse;
  if (!response.ok) {
    throw new Error(`Provider 生图失败：${readProviderError(payload) || response.status}`);
  }
  const firstImage = payload.data?.[0];
  if (typeof firstImage?.b64_json === "string" && firstImage.b64_json.trim()) {
    return {
      bytes: decodeBase64Image(firstImage.b64_json),
      contentType: "image/png",
    };
  }
  if (typeof firstImage?.url === "string" && firstImage.url.trim()) {
    return fetchGeneratedImage(firstImage.url);
  }
  throw new Error("Provider 没有返回图片。");
}

async function generateGrsaiDiaryImage(provider: StoredImageProvider, diaryText: string): Promise<GeneratedImage> {
  const response = await fetch(createGrsaiDrawUrl(provider.apiBaseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      prompt: buildDiaryImagePrompt(diaryText),
      size: "3:2",
      webHook: "-1",
    }),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Provider 生图失败：${readProviderErrorFromText(text) || response.status}`);
  }
  const imageUrl = readFirstUrl(text);
  if (imageUrl) {
    return fetchGeneratedImage(imageUrl);
  }
  const taskId = readTaskId(text);
  if (!taskId) {
    throw new Error("Provider 没有返回图片。");
  }
  return pollGrsaiDiaryImage(provider, taskId);
}

async function pollGrsaiDiaryImage(provider: StoredImageProvider, taskId: string): Promise<GeneratedImage> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (attempt > 0) {
      await sleep(2_000);
    }
    const response = await fetch(createGrsaiResultUrl(provider.apiBaseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ id: taskId }),
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(`Provider 生图结果读取失败：${readProviderErrorFromText(text) || response.status}`);
    }
    const status = readStatus(text);
    if (isFailedStatus(status)) {
      throw new Error(`Provider 生图失败：${readFailureReason(text) || "failed"}`);
    }
    const imageUrl = readFirstUrl(text);
    if (imageUrl) {
      return fetchGeneratedImage(imageUrl);
    }
  }
  throw new Error("Provider 生图超时，请稍后重试。");
}

async function fetchGeneratedImage(url: string): Promise<GeneratedImage> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Provider 图片读取失败：${response.status}`);
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "image/png",
  };
}

function isApiImageProvider(provider: MobileAiProviderRequest | null | undefined): provider is MobileAiProviderRequest {
  return provider?.mode === "api"
    && Boolean(readText(provider.apiBaseUrl))
    && Boolean(readText(provider.apiKey))
    && Boolean(readText(provider.model));
}

function assertProviderApiKey(apiKey: string): void {
  if (/^[a-z]:\\/i.test(apiKey) || [...apiKey].some((char) => char.charCodeAt(0) > 255)) {
    throw new Error("Provider API Key 不是有效密钥，请在设置页重新填写 Grsai 的 API Key。");
  }
}

function buildDiaryImagePrompt(diaryText: string): string {
  const clippedText = diaryText.replace(/\s+/g, " ").trim().slice(0, 1200);
  return `根据以下日记内容生成一张温暖、真实、无文字的日记封面图，适合横向时间线卡片展示。不要生成任何文字、标志或水印。\n\n${clippedText}`;
}

function hasImageMedia(mediaFiles: string[]): boolean {
  return mediaFiles.some((file) => /^data:image\//i.test(file) || /\.(png|jpe?g|webp|gif|heic|heif|avif)(\?|#|$)/i.test(file));
}

function createImagesUrl(apiBaseUrl: string): string {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "");
  return baseUrl.endsWith("/v1") ? `${baseUrl}/images/generations` : `${baseUrl}/v1/images/generations`;
}

function createGrsaiDrawUrl(apiBaseUrl: string): string {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${baseUrl}/v1/draw/completions`;
}

function createGrsaiResultUrl(apiBaseUrl: string): string {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${baseUrl}/v1/draw/result`;
}

function isGrsaiProvider(apiBaseUrl: string): boolean {
  return apiBaseUrl.toLowerCase().includes("grsai");
}

function buildMediaUrl(baseUrl: string, mediaKey: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/media/${mediaKey.split("/").map(encodeURIComponent).join("/")}`;
}

function decodeBase64Image(content: string): Uint8Array {
  const base64 = content.includes(",") ? content.split(",").pop() ?? "" : content;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function formatChinaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = readDatePart(parts, "year");
  const month = readDatePart(parts, "month");
  const day = readDatePart(parts, "day");
  return `${year}-${month}-${day}`;
}

function readDatePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

function readProviderError(payload: ProviderErrorPayload): string {
  const error = payload.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  if (typeof payload.message === "string") return payload.message;
  return "";
}

function readProviderErrorFromText(text: string): string {
  for (const payload of parseJsonRecords(text)) {
    const message = readProviderError(payload) || readText(payload.message);
    if (message) return message;
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

function readFirstUrl(text: string): string {
  for (const parsed of parseJsonRecords(text)) {
    const found = findUrl(parsed);
    if (found) return found;
  }
  return text.match(/https?:\/\/[^\s"'<>\\)]+/i)?.[0] || "";
}

function readTaskId(text: string): string {
  for (const payload of parseJsonRecords(text)) {
    const taskId = readNestedText(payload, ["data", "id"])
      || readNestedText(payload, ["data", "task_id"])
      || readNestedText(payload, ["data", "taskId"])
      || readText(payload.data)
      || readNestedText(payload, ["id"])
      || readNestedText(payload, ["task_id"])
      || readNestedText(payload, ["taskId"]);
    if (taskId) return taskId;
  }
  return "";
}

function readStatus(text: string): string {
  for (const payload of parseJsonRecords(text)) {
    const status = readNestedText(payload, ["data", "status"]) || readNestedText(payload, ["status"]);
    if (status) return status.toLowerCase();
  }
  return "";
}

function readFailureReason(text: string): string {
  for (const payload of parseJsonRecords(text)) {
    const reason = readNestedText(payload, ["data", "error"])
      || readNestedText(payload, ["data", "failure_reason"])
      || readNestedText(payload, ["failure_reason"])
      || readProviderError(payload);
    if (reason) return reason;
  }
  return readProviderErrorFromText(text);
}

function readNestedText(value: unknown, path: readonly string[]): string {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return "";
    }
    current = (current as Record<string, unknown>)[key];
  }
  return readText(current);
}

// fallow-ignore-next-line complexity
function findUrl(value: unknown): string {
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) ? value : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUrl(item);
      if (found) return found;
    }
    return "";
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  for (const key of ["url", "image_url", "imageUrl", "file_url", "fileUrl"]) {
    const found = findUrl(record[key]);
    if (found) return found;
  }
  for (const nested of Object.values(record)) {
    const found = findUrl(nested);
    if (found) return found;
  }
  return "";
}

function isFailedStatus(status: string): boolean {
  return status === "failed" || status === "failure" || status === "error" || status === "canceled" || status === "cancelled";
}

function parseJsonRecords(text: string): JsonRecord[] {
  const records: JsonRecord[] = [];
  const whole = parseJsonRecord(text);
  if (Object.keys(whole).length) records.push(whole);
  for (const line of text.split(/\r?\n/)) {
    const normalized = line.trim().replace(/^data:\s*/, "");
    if (!normalized || normalized === "[DONE]") continue;
    const parsed = parseJsonRecord(normalized);
    if (Object.keys(parsed).length) records.push(parsed);
  }
  return records;
}

function parseJsonRecord(text: string): JsonRecord {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonRecord : {};
  } catch {
    return {};
  }
}

function readErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
