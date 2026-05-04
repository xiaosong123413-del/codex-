import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerCLIProxyRoutes } from "../web/server/routes/cliproxy.js";

const hoisted = vi.hoisted(() => ({
  getCLIProxyAuthFileModels: vi.fn(),
  getCLIProxyCodexAccounts: vi.fn(),
  getCLIProxyOAuthAccounts: vi.fn(),
  getCLIProxyOAuthStatus: vi.fn(),
  getCLIProxyStatus: vi.fn(),
  installCLIProxySource: vi.fn(),
  deleteCLIProxyAccount: vi.fn(),
  startCLIProxy: vi.fn(),
  stopCLIProxy: vi.fn(),
  requestCLIProxyOAuth: vi.fn(),
  readCLIProxyConfig: vi.fn(),
  saveCLIProxyOpenAICompatibility: vi.fn(),
  setCLIProxyAccountEnabled: vi.fn(),
  setCLIProxyCodexAccountEnabled: vi.fn(),
  syncCLIProxyCodexTokenToWorker: vi.fn(),
}));

vi.mock("../web/server/services/cliproxy.js", () => hoisted);

describe("CLIProxyAPI routes", () => {
  beforeEach(() => {
    for (const value of Object.values(hoisted)) value.mockReset();
    hoisted.readCLIProxyConfig.mockReturnValue({ port: 8317, managementKey: "key", clientKey: "client" });
  });

  it("registers wiki-owned CLIProxyAPI management endpoints", async () => {
    hoisted.getCLIProxyStatus.mockResolvedValue({ running: true, accounts: [] });
    hoisted.installCLIProxySource.mockResolvedValue({ installed: true, sourceDir: "tools/CLIProxyAPI" });
    hoisted.startCLIProxy.mockResolvedValue({ running: true, proxyBaseUrl: "http://127.0.0.1:8317/v1" });
    hoisted.stopCLIProxy.mockResolvedValue({ running: false });
    hoisted.requestCLIProxyOAuth.mockResolvedValue({ url: "https://auth.example.com", state: "state" });
    hoisted.getCLIProxyOAuthStatus.mockResolvedValue({ status: "ok" });
    hoisted.getCLIProxyOAuthAccounts.mockResolvedValue({ accounts: [] });
    hoisted.getCLIProxyAuthFileModels.mockResolvedValue({ models: [] });
    hoisted.getCLIProxyCodexAccounts.mockResolvedValue({ accounts: [] });
    hoisted.deleteCLIProxyAccount.mockResolvedValue({ ok: true });
    hoisted.setCLIProxyAccountEnabled.mockResolvedValue({ ok: true });
    hoisted.setCLIProxyCodexAccountEnabled.mockResolvedValue({ ok: true });
    hoisted.saveCLIProxyOpenAICompatibility.mockResolvedValue({ ok: true });
    hoisted.syncCLIProxyCodexTokenToWorker.mockResolvedValue({ ok: true });

    const getRoutes: Array<{ path: string; handler: (req: unknown, res: { json: (body: unknown) => void }) => Promise<void> | void }> = [];
    const postRoutes: Array<{ path: string; handler: (req: { body?: unknown }, res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } }) => Promise<void> | void }> = [];
    const deleteRoutes: Array<{ path: string; handler: (req: { body?: unknown }, res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } }) => Promise<void> | void }> = [];
    const app = {
      get(path: string, handler: (req: unknown, res: { json: (body: unknown) => void }) => Promise<void> | void) {
        getRoutes.push({ path, handler });
        return app;
      },
      post(path: string, handler: (req: { body?: unknown }, res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } }) => Promise<void> | void) {
        postRoutes.push({ path, handler });
        return app;
      },
      delete(path: string, handler: (req: { body?: unknown }, res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } }) => Promise<void> | void) {
        deleteRoutes.push({ path, handler });
        return app;
      },
    };

    registerCLIProxyRoutes(app as never, { wikiRoot: "wiki", port: 4175, host: "127.0.0.1", author: "me", projectRoot: "project-root" });

    expect(getRoutes.map((route) => route.path)).toEqual([
      "/api/cliproxy/status",
      "/api/cliproxy/accounts",
      "/api/cliproxy/accounts/models",
      "/api/cliproxy/codex/accounts",
      "/api/cliproxy/oauth/status",
    ]);
    expect(postRoutes.map((route) => route.path)).toEqual([
      "/api/cliproxy/install",
      "/api/cliproxy/start",
      "/api/cliproxy/stop",
      "/api/cliproxy/oauth",
      "/api/cliproxy/accounts/enabled",
      "/api/cliproxy/accounts/sync-worker-token",
      "/api/cliproxy/codex/accounts/enabled",
      "/api/cliproxy/openai-compatibility",
    ]);
    expect(deleteRoutes.map((route) => route.path)).toEqual([
      "/api/cliproxy/accounts",
    ]);

    const json = vi.fn();
    await getRoutes[0]?.handler({}, { json });
    expect(hoisted.getCLIProxyStatus).toHaveBeenCalledWith({ port: 8317, managementKey: "key", clientKey: "client" });
    expect(json).toHaveBeenCalledWith({ success: true, data: { running: true, accounts: [] } });

    await getRoutes[1]?.handler({ query: { refresh: "1" } }, { json });
    expect(hoisted.getCLIProxyOAuthAccounts).toHaveBeenCalledWith({
      port: 8317,
      managementKey: "key",
      clientKey: "client",
      projectRoot: "project-root",
      refreshQuota: true,
    });

    await getRoutes[2]?.handler({ query: { name: "gemini.json" } }, { json });
    expect(hoisted.getCLIProxyAuthFileModels).toHaveBeenCalledWith({
      port: 8317,
      managementKey: "key",
      clientKey: "client",
      name: "gemini.json",
    });

    await getRoutes[3]?.handler({ query: { refresh: "1" } }, { json });
    expect(hoisted.getCLIProxyCodexAccounts).toHaveBeenCalledWith({
      port: 8317,
      managementKey: "key",
      clientKey: "client",
      projectRoot: "project-root",
      refreshQuota: true,
    });

    await getRoutes[4]?.handler({ query: { state: "state" } }, { json });
    expect(hoisted.getCLIProxyOAuthStatus).toHaveBeenCalledWith({ port: 8317, managementKey: "key", clientKey: "client", state: "state" });

    await postRoutes[2]?.handler({ body: {} }, { json, status: vi.fn(() => ({ json })) });
    expect(hoisted.stopCLIProxy).toHaveBeenCalledOnce();

    await postRoutes[3]?.handler({ body: { provider: "codex" } }, { json, status: vi.fn(() => ({ json })) });
    expect(hoisted.requestCLIProxyOAuth).toHaveBeenCalledWith({ port: 8317, managementKey: "key", clientKey: "client", provider: "codex" });

    await postRoutes[4]?.handler({ body: { name: "gemini.json", enabled: false } }, { json, status: vi.fn(() => ({ json })) });
    expect(hoisted.setCLIProxyAccountEnabled).toHaveBeenCalledWith({
      port: 8317,
      managementKey: "key",
      clientKey: "client",
      name: "gemini.json",
      enabled: false,
    });

    await deleteRoutes[0]?.handler({ body: { name: "gemini.json" } }, { json, status: vi.fn(() => ({ json })) });
    expect(hoisted.deleteCLIProxyAccount).toHaveBeenCalledWith({
      port: 8317,
      managementKey: "key",
      clientKey: "client",
      projectRoot: "project-root",
      name: "gemini.json",
    });

    await postRoutes[5]?.handler({ body: { name: "codex.json", ownerUid: "owner", workerUrl: "https://worker.example.com", remoteToken: "remote" } }, { json, status: vi.fn(() => ({ json })) });
    expect(hoisted.syncCLIProxyCodexTokenToWorker).toHaveBeenCalledWith({
      port: 8317,
      managementKey: "key",
      clientKey: "client",
      projectRoot: "project-root",
      name: "codex.json",
      ownerUid: "owner",
      workerUrl: "https://worker.example.com",
      remoteToken: "remote",
    });

    await postRoutes[6]?.handler({ body: { name: "codex.json", enabled: false } }, { json, status: vi.fn(() => ({ json })) });
    expect(hoisted.setCLIProxyCodexAccountEnabled).toHaveBeenCalledWith({
      port: 8317,
      managementKey: "key",
      clientKey: "client",
      name: "codex.json",
      enabled: false,
    });
  });
});
