/**
 * Real-time wiki publish event channel for the Remote Brain Worker.
 *
 * The public wiki keeps one WebSocket open to this Durable Object. Publish
 * routes send one event after a successful D1/R2 write, and the object
 * broadcasts that event to all connected browsers.
 */
import { json, safeJson } from "./worker-support.js";

interface WikiPublishEventEnv {
  WIKI_PUBLISH_EVENTS?: DurableObjectNamespace;
}

interface WikiPublishEventPayload {
  publishVersion: string;
  publishedAt: string;
  pageCount: number;
  scope: "global" | "account";
  workspaceId?: string;
}

interface WikiEventMessage extends WikiPublishEventPayload {
  type: "wiki-published";
}

const WIKI_EVENT_ROOM_ID = "public-wiki";

export class WikiPublishEvents {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/broadcast") {
      return this.broadcast(request);
    }
    if (!isWebSocketRequest(request)) {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    return this.acceptWebSocket();
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (message === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
    }
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }

  private acceptWebSocket(): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "connected" }));
    return new Response(null, { status: 101, webSocket: client });
  }

  private async broadcast(request: Request): Promise<Response> {
    const payload = normalizeWikiPublishEvent(await safeJson<Partial<WikiPublishEventPayload>>(request));
    const message: WikiEventMessage = { type: "wiki-published", ...payload };
    const sent = sendToOpenSockets(this.state.getWebSockets(), JSON.stringify(message));
    return json({ ok: true, sent });
  }
}

export function handleWikiPublishEvents(
  request: Request,
  env: WikiPublishEventEnv,
): Response | Promise<Response> {
  if (!isWebSocketRequest(request)) {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }
  const stub = getWikiEventsStub(env);
  if (!stub) return json({ ok: false, error: "missing_wiki_events_binding" }, 500);
  return stub.fetch(request);
}

export async function notifyWikiPublished(
  env: WikiPublishEventEnv,
  payload: WikiPublishEventPayload,
): Promise<void> {
  const stub = getWikiEventsStub(env);
  if (!stub) return;
  await stub.fetch("https://wiki-publish-events.local/broadcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}

function getWikiEventsStub(env: WikiPublishEventEnv): DurableObjectStub | null {
  if (!env.WIKI_PUBLISH_EVENTS) return null;
  const id = env.WIKI_PUBLISH_EVENTS.idFromName(WIKI_EVENT_ROOM_ID);
  return env.WIKI_PUBLISH_EVENTS.get(id);
}

function isWebSocketRequest(request: Request): boolean {
  return request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

function normalizeWikiPublishEvent(input: Partial<WikiPublishEventPayload>): WikiPublishEventPayload {
  return {
    publishVersion: String(input.publishVersion ?? ""),
    publishedAt: String(input.publishedAt ?? new Date().toISOString()),
    pageCount: Number(input.pageCount ?? 0),
    scope: input.scope === "account" ? "account" : "global",
    workspaceId: input.workspaceId ? String(input.workspaceId) : undefined,
  };
}

function sendToOpenSockets(sockets: readonly WebSocket[], message: string): number {
  let sent = 0;
  for (const socket of sockets) {
    try {
      socket.send(message);
      sent += 1;
    } catch {
      socket.close(1011, "send_failed");
    }
  }
  return sent;
}
