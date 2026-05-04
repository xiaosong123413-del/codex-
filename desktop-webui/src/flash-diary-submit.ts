/**
 * Quick-capture submission routing.
 *
 * Converts the desktop shortcut window payload into the smallest server
 * request needed for diary appends, text-only clipping notes, and link
 * extraction pipelines.
 */
interface FlashDiaryEntryPayload {
  target?: "flash-diary" | "clipping";
  text: string;
  mediaPaths: string[];
  clippingUrl?: string;
  clippingComment?: string;
}

interface FlashDiarySubmission {
  endpoint: "api/flash-diary/entry" | "api/source-gallery/create" | "smartclip-mcp";
  body: FlashDiaryEntryPayload | {
    type: "clipping";
    title: string;
    body: string;
    now: string;
    mediaPaths: string[];
  } | {
    url: string;
    body: string;
    now: string;
    mediaPaths: string[];
  };
}

/**
 * Chooses the backend endpoint while preserving clipping comment text as user
 * notes instead of mixing it with the URL parsing field.
 */
export function buildFlashDiarySubmission(payload: FlashDiaryEntryPayload): FlashDiarySubmission {
  const target = payload.target === "clipping" ? "clipping" : "flash-diary";
  if (target === "flash-diary") {
    return {
      endpoint: "api/flash-diary/entry",
      body: {
        target,
        text: payload.text,
        mediaPaths: payload.mediaPaths,
      },
    };
  }

  const clippingBody = payload.clippingComment ?? payload.text;
  const clippingUrl = extractFirstUrl(payload.clippingUrl ?? "") ?? extractFirstUrl(payload.text);
  const now = new Date().toISOString();
  if (!clippingUrl) {
    return {
      endpoint: "api/source-gallery/create",
      body: {
        type: "clipping",
        title: now,
        body: clippingBody,
        now,
        mediaPaths: payload.mediaPaths,
      },
    };
  }

  return {
    endpoint: "smartclip-mcp",
    body: {
      url: clippingUrl,
      body: clippingBody,
      now,
      mediaPaths: payload.mediaPaths,
    },
  };
}

function extractFirstUrl(value: string): string | null {
  const raw = value.match(/https?:\/\/[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+/i)?.[0] ?? null;
  return raw ? raw.replace(/[，。、“”‘’；;,.!?！？）)】\]]+$/u, "") : null;
}
