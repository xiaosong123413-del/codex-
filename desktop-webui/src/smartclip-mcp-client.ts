/**
 * SmartClip MCP client for the desktop quick-capture flow.
 *
 * The desktop app owns this process-level client so link clipping can use the
 * SmartClip browser extension without requiring a project-level `.mcp.json`.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const SMARTCLIP_TOOL_NAME = "clip_page";
const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;
const DEFAULT_INIT_TIMEOUT_MS = 30_000;
const MAX_STDERR_LINES = 12;

interface SmartClipMcpClipInput {
  readonly url: string;
  readonly mode?: "full" | "selection";
}

export interface SmartClipMcpClipResult {
  readonly url: string;
  readonly title?: string;
  readonly markdown: string;
  readonly warning?: string;
  readonly taskId?: string;
}

interface SmartClipMcpClientOptions {
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly requestTimeoutMs?: number;
  readonly initializeTimeoutMs?: number;
}

interface ResolvedSmartClipMcpClientOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly requestTimeoutMs: number;
  readonly initializeTimeoutMs: number;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: unknown;
}

let sharedSession: SmartClipMcpSession | null = null;

/**
 * Extracts a page through SmartClip and returns the Markdown content.
 */
export async function clipPageWithSmartClip(
  input: SmartClipMcpClipInput,
  options: SmartClipMcpClientOptions = {},
): Promise<SmartClipMcpClipResult> {
  const session = await getSharedSession(options);
  const response = await session.callTool(SMARTCLIP_TOOL_NAME, {
    url: input.url,
    mode: input.mode ?? "full",
  });
  return normalizeClipResult(response, input);
}

/**
 * Stops the shared SmartClip MCP process when the Electron app exits.
 */
export function stopSmartClipMcpClient(): void {
  sharedSession?.dispose();
  sharedSession = null;
}

async function getSharedSession(options: SmartClipMcpClientOptions): Promise<SmartClipMcpSession> {
  if (!sharedSession || sharedSession.closed) {
    sharedSession = new SmartClipMcpSession(resolveOptions(options));
  }
  try {
    await sharedSession.ready();
    return sharedSession;
  } catch (error) {
    sharedSession.dispose();
    sharedSession = null;
    throw error;
  }
}

// fallow-ignore-next-line complexity
function resolveOptions(options: SmartClipMcpClientOptions): ResolvedSmartClipMcpClientOptions {
  return {
    command: options.command ?? defaultNpxCommand(),
    args: options.args ?? ["-y", "smartclip-mcp"],
    env: options.env ?? process.env,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    initializeTimeoutMs: options.initializeTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS,
  };
}

function defaultNpxCommand(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

class SmartClipMcpSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly initialized: Promise<void>;
  private stdoutBuffer = "";
  private nextId = 1;
  private isClosed = false;
  private stderrTail: string[] = [];

  constructor(private readonly options: ResolvedSmartClipMcpClientOptions) {
    this.child = spawn(options.command, [...options.args], {
      env: options.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.acceptStdout(String(chunk)));
    this.child.stderr.on("data", (chunk) => this.acceptStderr(String(chunk)));
    this.child.on("error", (error) => this.closeWithError(error));
    this.child.on("exit", (code, signal) => this.closeWithError(this.exitError(code, signal)));
    this.initialized = this.initialize();
  }

  get closed(): boolean {
    return this.isClosed;
  }

  async ready(): Promise<void> {
    await this.initialized;
  }

  async callTool(name: string, toolArguments: unknown): Promise<unknown> {
    return await this.sendRequest("tools/call", {
      name,
      arguments: toolArguments,
    }, this.options.requestTimeoutMs);
  }

  dispose(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.rejectAll(new Error("SmartClip MCP client stopped"));
    this.child.kill();
  }

  private async initialize(): Promise<void> {
    await this.sendRequest("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "llm-wiki-desktop", version: "0.1.1" },
    }, this.options.initializeTimeoutMs);
    this.sendNotification("notifications/initialized", {});
  }

  private sendRequest(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.isClosed) return Promise.reject(new Error("SmartClip MCP client is not running"));
    const id = this.nextId;
    this.nextId += 1;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return this.writeRequest(id, request, timeoutMs);
  }

  private writeRequest(id: number, request: JsonRpcRequest, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.rejectRequest(id, `${request.method} timed out`), timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (error) this.rejectRequest(id, error.message);
      });
    });
  }

  private sendNotification(method: string, params: unknown): void {
    if (this.isClosed) return;
    const notification: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.child.stdin.write(`${JSON.stringify(notification)}\n`);
  }

  private acceptStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) this.handleStdoutLine(line);
  }

  // fallow-ignore-next-line complexity
  private handleStdoutLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    const message = parseJsonObject(trimmed);
    const id = readNumber(message?.id);
    if (id === undefined) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    const error = readJsonRpcError(message?.error);
    if (error) pending.reject(new Error(error));
    else pending.resolve(message?.result);
  }

  private acceptStderr(chunk: string): void {
    const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    this.stderrTail = [...this.stderrTail, ...lines].slice(-MAX_STDERR_LINES);
  }

  private rejectRequest(id: number, message: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.reject(new Error(this.withStderr(message)));
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private closeWithError(error: Error): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.rejectAll(new Error(this.withStderr(error.message)));
  }

  private exitError(code: number | null, signal: NodeJS.Signals | null): Error {
    const detail = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
    return new Error(`SmartClip MCP process stopped (${detail})`);
  }

  private withStderr(message: string): string {
    return this.stderrTail.length > 0 ? `${message}\n${this.stderrTail.join("\n")}` : message;
  }
}

// fallow-ignore-next-line complexity
function normalizeClipResult(response: unknown, input: SmartClipMcpClipInput): SmartClipMcpClipResult {
  const record = asRecord(response);
  if (record?.isError === true) throw new Error(readContentText(record.content) || "SmartClip 剪藏失败");
  const structured = asRecord(record?.structuredContent);
  const markdown = readString(structured?.markdown) ?? readMarkdownFromContent(record?.content);
  if (!markdown) throw new Error("SmartClip 未返回 Markdown 内容");
  return {
    url: readString(structured?.url) ?? input.url,
    title: readString(structured?.title),
    markdown,
    warning: readString(structured?.warning),
    taskId: readString(structured?.taskId),
  };
}

function readMarkdownFromContent(value: unknown): string | undefined {
  const text = readContentText(value);
  if (!text) return undefined;
  const marker = "=== Markdown 内容 ===";
  const markerIndex = text.indexOf(marker);
  return markerIndex >= 0 ? text.slice(markerIndex + marker.length).trim() : text.trim();
}

function readContentText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(readTextContentItem).filter(Boolean).join("\n").trim() || undefined;
}

function readTextContentItem(value: unknown): string {
  const record = asRecord(value);
  return record?.type === "text" ? readString(record.text) ?? "" : "";
}

function readJsonRpcError(value: unknown): string | undefined {
  const record = asRecord(value);
  return readString(record?.message);
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
