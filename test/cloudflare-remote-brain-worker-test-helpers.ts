/**
 * Shared runtime harness helpers for Cloudflare Remote Brain Worker tests.
 * They keep route-level tests small while exercising the real worker fetch
 * entrypoint with a minimal in-memory D1/R2 environment.
 */

import worker from "../cloudflare/remote-brain-worker/src/index.js";

export type WorkerEnv = Parameters<typeof worker.fetch>[1];

type DbResolverResult = {
  first?: Record<string, unknown> | null;
  results?: Array<Record<string, unknown>>;
  run?: unknown;
};

interface DbCall {
  sql: string;
  params: unknown[];
}

export function createEnv(overrides: Partial<WorkerEnv>): WorkerEnv {
  return {
    REMOTE_TOKEN: "secret-token",
    ...overrides,
  } as WorkerEnv;
}

export function createAuthorizedRequest(path: string, body: unknown): Request {
  return new Request(`https://remote-brain.example${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: "Bearer secret-token",
    },
    body: JSON.stringify(body),
  });
}

export function createDbHarness(
  resolver: (sql: string, params: unknown[]) => DbResolverResult | Promise<DbResolverResult>,
): { calls: DbCall[]; db: WorkerEnv["DB"] } {
  const calls: DbCall[] = [];
  return {
    calls,
    db: {
      prepare(sql: string) {
        return createStatement(sql, calls, resolver);
      },
      batch(statements: Array<{ run(): Promise<unknown> | unknown }>) {
        return Promise.all(statements.map((statement) => statement.run()));
      },
    } as WorkerEnv["DB"],
  };
}

function createStatement(
  sql: string,
  calls: DbCall[],
  resolver: (sql: string, params: unknown[]) => DbResolverResult | Promise<DbResolverResult>,
): {
  bind(...params: unknown[]): ReturnType<typeof createBoundStatement>;
  run(): Promise<unknown>;
  all(): Promise<{ results: Array<Record<string, unknown>> }>;
  first(): Promise<Record<string, unknown> | null>;
} {
  return {
    bind(...params: unknown[]) {
      return createBoundStatement(sql, params, calls, resolver);
    },
    run() {
      return executeRun(sql, [], calls, resolver);
    },
    all() {
      return executeAll(sql, [], calls, resolver);
    },
    first() {
      return executeFirst(sql, [], calls, resolver);
    },
  };
}

function createBoundStatement(
  sql: string,
  params: unknown[],
  calls: DbCall[],
  resolver: (sql: string, params: unknown[]) => DbResolverResult | Promise<DbResolverResult>,
): {
  run(): Promise<unknown>;
  all(): Promise<{ results: Array<Record<string, unknown>> }>;
  first(): Promise<Record<string, unknown> | null>;
} {
  return {
    run() {
      return executeRun(sql, params, calls, resolver);
    },
    all() {
      return executeAll(sql, params, calls, resolver);
    },
    first() {
      return executeFirst(sql, params, calls, resolver);
    },
  };
}

async function executeRun(
  sql: string,
  params: unknown[],
  calls: DbCall[],
  resolver: (sql: string, params: unknown[]) => DbResolverResult | Promise<DbResolverResult>,
): Promise<unknown> {
  const result = await resolveDb(sql, params, calls, resolver);
  return result.run ?? { success: true };
}

async function executeAll(
  sql: string,
  params: unknown[],
  calls: DbCall[],
  resolver: (sql: string, params: unknown[]) => DbResolverResult | Promise<DbResolverResult>,
): Promise<{ results: Array<Record<string, unknown>> }> {
  const result = await resolveDb(sql, params, calls, resolver);
  return { results: result.results ?? [] };
}

async function executeFirst(
  sql: string,
  params: unknown[],
  calls: DbCall[],
  resolver: (sql: string, params: unknown[]) => DbResolverResult | Promise<DbResolverResult>,
): Promise<Record<string, unknown> | null> {
  const result = await resolveDb(sql, params, calls, resolver);
  return result.first ?? null;
}

async function resolveDb(
  sql: string,
  params: unknown[],
  calls: DbCall[],
  resolver: (sql: string, params: unknown[]) => DbResolverResult | Promise<DbResolverResult>,
): Promise<DbResolverResult> {
  calls.push({ sql, params: [...params] });
  return await resolver(sql, params);
}

export function createBucketHarness(seed: Record<string, string> = {}): {
  bucket: WorkerEnv["WIKI_BUCKET"];
  puts: Array<{ key: string; value: string }>;
} {
  const puts: Array<{ key: string; value: string }> = [];
  const objects = new Map<string, string>(Object.entries(seed));
  return {
    puts,
    bucket: {
      async put(key: string, value: unknown) {
        const text = String(value);
        puts.push({ key, value: text });
        objects.set(key, text);
      },
      async get(key: string) {
        const text = objects.get(key);
        if (typeof text !== "string") return null;
        return {
          body: text,
          async text() {
            return text;
          },
        };
      },
    } as WorkerEnv["WIKI_BUCKET"],
  };
}

export function createDurableObjectNamespaceHarness(): {
  namespace: WorkerEnv["WIKI_PUBLISH_EVENTS"];
  broadcasts: Array<Record<string, unknown>>;
} {
  const broadcasts: Array<Record<string, unknown>> = [];
  return {
    broadcasts,
    namespace: {
      idFromName(name: string) {
        return { name };
      },
      get() {
        return {
          async fetch(input: RequestInfo | URL, init?: RequestInit) {
            const request = new Request(input, init);
            broadcasts.push(await request.json() as Record<string, unknown>);
            return new Response(JSON.stringify({ ok: true, sent: 0 }), {
              headers: { "content-type": "application/json" },
            });
          },
        };
      },
    } as WorkerEnv["WIKI_PUBLISH_EVENTS"],
  };
}
