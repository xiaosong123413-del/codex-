/**
 * Discovers embedding endpoint choices for the settings UI.
 *
 * The vector index only needs an OpenAI-compatible /v1/embeddings endpoint.
 * This module keeps the UI honest by listing network presets separately from
 * local processes that are actually listening on common ports.
 */

import net from "node:net";
import { readLocalEmbeddingServiceStatus } from "./local-embedding-process.js";
import { type EmbeddingSource } from "./search-vector-config.js";

type EmbeddingServiceStatus = "available" | "unavailable" | "not_checked";

interface EmbeddingServiceOption {
  id: string;
  name: string;
  source: EmbeddingSource;
  endpoint: string;
  model: string;
  status: EmbeddingServiceStatus;
  description: string;
  managedByApp: boolean;
  managedRunning: boolean;
}

interface ServicePreset {
  id: string;
  name: string;
  source: EmbeddingSource;
  endpoint: string;
  model: string;
  description: string;
}

const NETWORK_PRESETS: readonly ServicePreset[] = [
  {
    id: "openai",
    name: "OpenAI embeddings",
    source: "api",
    endpoint: "https://api.openai.com/v1/embeddings",
    model: "text-embedding-3-small",
    description: "官方 OpenAI 兼容接口，需要 API Key。",
  },
  {
    id: "xiaoma",
    name: "小马中转",
    source: "api",
    endpoint: "https://xiaoma.best/v1/embeddings",
    model: "text-embedding-3-small",
    description: "中转站 OpenAI 兼容接口，需要可用 embedding 渠道。",
  },
] as const;

const LOCAL_PRESETS: readonly ServicePreset[] = [
  {
    id: "local-qwen",
    name: "本机 Qwen embedding",
    source: "local",
    endpoint: "http://127.0.0.1:8011/v1/embeddings",
    model: "Qwen3-Embedding-8B",
    description: "推荐给本机 Qwen3 embedding 服务使用。",
  },
  {
    id: "local-openai-8000",
    name: "本机 OpenAI 兼容 8000",
    source: "local",
    endpoint: "http://127.0.0.1:8000/v1/embeddings",
    model: "Qwen3-Embedding-8B",
    description: "常见 FastAPI / vLLM / 自建服务端口。",
  },
  {
    id: "local-tei-8080",
    name: "本机 TEI 8080",
    source: "local",
    endpoint: "http://127.0.0.1:8080/v1/embeddings",
    model: "Qwen3-Embedding-8B",
    description: "常见 Text Embeddings Inference 端口。",
  },
  {
    id: "local-lmstudio-1234",
    name: "LM Studio 1234",
    source: "local",
    endpoint: "http://127.0.0.1:1234/v1/embeddings",
    model: "text-embedding-model",
    description: "LM Studio 本机 OpenAI-compatible 服务。",
  },
  {
    id: "local-ollama-11434",
    name: "Ollama 11434",
    source: "local",
    endpoint: "http://127.0.0.1:11434/v1/embeddings",
    model: "nomic-embed-text",
    description: "Ollama 本机 OpenAI-compatible 服务，模型名按本机实际安装修改。",
  },
  {
    id: "local-xinference-9997",
    name: "Xinference 9997",
    source: "local",
    endpoint: "http://127.0.0.1:9997/v1/embeddings",
    model: "bge-m3",
    description: "Xinference 本机 OpenAI-compatible 服务。",
  },
] as const;

/** Returns selectable embedding services with lightweight local reachability. */
export async function listEmbeddingServices(): Promise<EmbeddingServiceOption[]> {
  const network = NETWORK_PRESETS.map((preset) => toOption(preset, "not_checked"));
  const local = await Promise.all(LOCAL_PRESETS.map(localServiceOption));
  return [...network, ...local];
}

async function localServiceOption(preset: ServicePreset): Promise<EmbeddingServiceOption> {
  const status = await isEndpointListening(preset.endpoint) ? "available" : "unavailable";
  return toOption(preset, status);
}

function toOption(preset: ServicePreset, status: EmbeddingServiceStatus): EmbeddingServiceOption {
  const managed = preset.id === "local-qwen" ? readLocalEmbeddingServiceStatus() : null;
  return {
    ...preset,
    status,
    managedByApp: Boolean(managed),
    managedRunning: managed?.running ?? false,
  };
}

async function isEndpointListening(endpoint: string): Promise<boolean> {
  const url = new URL(endpoint);
  const port = Number.parseInt(url.port || defaultPort(url.protocol), 10);
  return checkTcpPort(url.hostname, port);
}

function defaultPort(protocol: string): string {
  return protocol === "https:" ? "443" : "80";
}

function checkTcpPort(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const settle = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(450);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}
