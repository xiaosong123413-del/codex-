import { json } from "./worker-support.js";

interface MobileCloudflareQuotaEnv {
  DB?: D1Database;
  WIKI_BUCKET?: R2Bucket;
  MEDIA_BUCKET?: R2Bucket;
  VECTORIZE?: VectorizeIndex;
  AI?: Ai;
  QUOTA_READER_URL?: string;
  QUOTA_READER_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
}

interface WorkersAiUsage {
  usedNeurons: number | null;
  remainingNeurons: number | null;
  error: string | null;
}

interface CloudflareGraphqlResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        aiInferenceAdaptiveGroups?: Array<{
          sum?: {
            totalNeurons?: unknown;
          } | null;
        }>;
      }>;
    };
  };
  errors?: Array<{ message?: string }>;
}

const WORKERS_AI_DAILY_INCLUDED_NEURONS = 10_000;

export async function handleMobileCloudflareQuotaStatus(env: MobileCloudflareQuotaEnv): Promise<Response> {
  const accountId = readText(env.CLOUDFLARE_ACCOUNT_ID);
  const apiToken = readText(env.CLOUDFLARE_API_TOKEN);
  const usage = accountId && apiToken ? await readWorkersAiUsage(accountId, apiToken) : null;
  const resetAt = nextUtcMidnight();

  return json({
    ok: true,
    checkedAt: new Date().toISOString(),
    worker: {
      d1: Boolean(env.DB),
      r2: Boolean(env.WIKI_BUCKET),
      mediaR2: Boolean(env.MEDIA_BUCKET),
      vectorize: Boolean(env.VECTORIZE),
      ai: Boolean(env.AI),
      quotaReader: Boolean(readText(env.QUOTA_READER_URL) && readText(env.QUOTA_READER_TOKEN)),
    },
    workersAi: {
      dailyIncludedNeurons: WORKERS_AI_DAILY_INCLUDED_NEURONS,
      resetAt: resetAt.toISOString(),
      liveUsageAvailable: Boolean(accountId && apiToken && !usage?.error),
      usedNeurons: usage?.usedNeurons ?? null,
      remainingNeurons: usage?.remainingNeurons ?? null,
      error: usage?.error ?? null,
    },
  });
}

async function readWorkersAiUsage(accountId: string, apiToken: string, now = new Date()): Promise<WorkersAiUsage> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const end = nextUtcMidnight(now);
  const query = `query WorkersAiUsage($accountTag: string!, $start: Time!, $end: Time!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        aiInferenceAdaptiveGroups(limit: 1, filter: { datetime_geq: $start, datetime_lt: $end }) {
          sum {
            totalNeurons
          }
        }
      }
    }
  }`;

  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: accountId,
          start: start.toISOString(),
          end: end.toISOString(),
        },
      }),
    });
    if (!response.ok) {
      return quotaError(`Cloudflare GraphQL HTTP ${response.status}`);
    }

    const payload = await response.json<CloudflareGraphqlResponse>();
    const graphqlError = payload.errors?.map((error) => error.message).filter(Boolean).join("; ");
    if (graphqlError) {
      return quotaError(graphqlError);
    }

    const usedNeurons = readNumber(payload.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups?.[0]?.sum?.totalNeurons) ?? 0;
    return {
      usedNeurons,
      remainingNeurons: Math.max(0, WORKERS_AI_DAILY_INCLUDED_NEURONS - usedNeurons),
      error: null,
    };
  } catch (error) {
    return quotaError(error instanceof Error ? error.message : "Cloudflare GraphQL request failed");
  }
}

function quotaError(message: string): WorkersAiUsage {
  return {
    usedNeurons: null,
    remainingNeurons: null,
    error: message,
  };
}

function nextUtcMidnight(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
