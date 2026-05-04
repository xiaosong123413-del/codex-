/**
 * Focused coverage for the Remote Brain wiki publish event Durable Object.
 *
 * Cloudflare calls these lifecycle methods by name at runtime, so the tests
 * keep the public class surface visible to the local health analyzer.
 */
import { describe, expect, it } from "vitest";
import { WikiPublishEvents } from "../cloudflare/remote-brain-worker/src/wiki-publish-events.js";

describe("Cloudflare wiki publish events", () => {
  it("rejects non-WebSocket event requests", async () => {
    const object = new WikiPublishEvents(createStateHarness());
    const response = await object.fetch(new Request("https://remote-brain.example/wiki/events"));

    expect(response.status).toBe(426);
    await expect(response.text()).resolves.toContain("Expected WebSocket upgrade");
  });

  it("answers ping and closes sockets through runtime lifecycle callbacks", () => {
    const object = new WikiPublishEvents(createStateHarness());
    const sent: string[] = [];
    const closed: Array<{ code: number; reason: string }> = [];
    const socket = {
      send(value: string) {
        sent.push(value);
      },
      close(code: number, reason: string) {
        closed.push({ code, reason });
      },
    } as WebSocket;

    object.webSocketMessage(socket, "ping");
    object.webSocketClose(socket, 1000, "done");

    expect(JSON.parse(sent[0] ?? "{}")).toMatchObject({ type: "pong" });
    expect(closed).toEqual([{ code: 1000, reason: "done" }]);
  });
});

function createStateHarness(): ConstructorParameters<typeof WikiPublishEvents>[0] {
  return {
    acceptWebSocket() {
      return undefined;
    },
    getWebSockets() {
      return [];
    },
  } as unknown as ConstructorParameters<typeof WikiPublishEvents>[0];
}
