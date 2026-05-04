/**
 * Starts and tracks the bundled local embedding HTTP service.
 *
 * The WebUI can launch the service, but model loading still depends on local
 * Python ML dependencies and the machine having enough memory for the model.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

interface LocalEmbeddingProcessStatus {
  running: boolean;
  endpoint: string;
  model: string;
  pid: number | null;
  message: string;
}

const PORT = 8011;
const HOST = "127.0.0.1";
const MODEL = "Qwen3-Embedding-8B";
const ENDPOINT = `http://${HOST}:${PORT}/v1/embeddings`;
const MAX_LOG_LENGTH = 3000;

let child: ChildProcessWithoutNullStreams | null = null;
let lastMessage = "本机 embedding 服务未启动。";

/** Starts the bundled Qwen embedding service if it is not already running. */
export function startLocalEmbeddingService(projectRoot: string): LocalEmbeddingProcessStatus {
  if (child && !child.killed) return processStatus("本机 embedding 服务已在运行。");
  const modelDir = path.join(projectRoot, ".models", MODEL);
  const scriptPath = path.join(projectRoot, "scripts", "local-qwen-embedding-server.py");
  assertServiceFiles(modelDir, scriptPath);
  child = spawn(readPythonCommand(), [
    scriptPath,
    "--model-dir",
    modelDir,
    "--host",
    HOST,
    "--port",
    String(PORT),
  ], {
    cwd: projectRoot,
    windowsHide: true,
  });
  lastMessage = "正在启动本机 embedding 服务，首次加载 8B 模型会比较慢。";
  child.stdout.on("data", (chunk) => appendMessage(chunk.toString()));
  child.stderr.on("data", (chunk) => appendMessage(chunk.toString()));
  child.once("exit", (code) => {
    child = null;
    appendMessage(`本机 embedding 服务已退出，代码 ${code ?? "unknown"}。`);
  });
  return processStatus(lastMessage);
}

/** Stops the child process started by this WebUI session. */
export function stopLocalEmbeddingService(): LocalEmbeddingProcessStatus {
  if (!child || child.killed) return processStatus("本机 embedding 服务未由当前应用启动。");
  child.kill();
  child = null;
  lastMessage = "已发送停止本机 embedding 服务的请求。";
  return processStatus(lastMessage);
}

/** Reads the current child-process status. */
export function readLocalEmbeddingServiceStatus(): LocalEmbeddingProcessStatus {
  return processStatus(lastMessage);
}

function assertServiceFiles(modelDir: string, scriptPath: string): void {
  if (!fs.existsSync(scriptPath)) throw new Error(`启动脚本不存在：${scriptPath}`);
  if (!fs.existsSync(modelDir)) throw new Error(`模型目录不存在：${modelDir}`);
}

function readPythonCommand(): string {
  return process.env.LLMWIKI_EMBEDDING_PYTHON?.trim() || "python";
}

function processStatus(message: string): LocalEmbeddingProcessStatus {
  return {
    running: Boolean(child && !child.killed),
    endpoint: ENDPOINT,
    model: MODEL,
    pid: child?.pid ?? null,
    message,
  };
}

function appendMessage(text: string): void {
  const next = `${lastMessage}\n${text.trim()}`.trim();
  lastMessage = next.length > MAX_LOG_LENGTH ? next.slice(-MAX_LOG_LENGTH) : next;
}
