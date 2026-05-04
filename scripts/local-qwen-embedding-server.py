"""OpenAI-compatible local embedding server for downloaded Qwen models.

This script is intentionally small and dependency-light at the HTTP layer. It
expects `sentence_transformers` to load the local model directory and exposes
only the endpoints needed by LLM Wiki vector search.
"""

from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8011)
    return parser.parse_args()


def load_model(model_dir: str) -> Any:
    try:
        from sentence_transformers import SentenceTransformer
    except Exception as exc:
        raise RuntimeError(
            "缺少 Python 依赖 sentence-transformers。请先安装：python -m pip install sentence-transformers"
        ) from exc
    return SentenceTransformer(model_dir, trust_remote_code=True)


def normalize_inputs(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return value
    raise ValueError("input 必须是字符串或字符串数组。")


def response_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class EmbeddingHandler(BaseHTTPRequestHandler):
    model: Any = None
    model_name = "Qwen3-Embedding-8B"

    def do_GET(self) -> None:
        if self.path == "/health":
            self.write_json(200, {"ok": True, "model": self.model_name})
            return
        self.write_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/v1/embeddings":
            self.write_json(404, {"error": "not found"})
            return
        try:
            payload = self.read_json()
            texts = normalize_inputs(payload.get("input"))
            embeddings = self.model.encode(texts, normalize_embeddings=True)
            self.write_json(200, make_embedding_response(texts, embeddings, self.model_name))
        except Exception as exc:
            self.write_json(400, {"error": {"message": str(exc)}})

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        parsed = json.loads(raw or "{}")
        if not isinstance(parsed, dict):
            raise ValueError("JSON body 必须是对象。")
        return parsed

    def write_json(self, status: int, payload: dict[str, Any]) -> None:
        body = response_bytes(payload)
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def make_embedding_response(texts: list[str], embeddings: Any, model_name: str) -> dict[str, Any]:
    vectors = embeddings.tolist() if hasattr(embeddings, "tolist") else embeddings
    return {
        "object": "list",
        "model": model_name,
        "data": [
            {"object": "embedding", "index": index, "embedding": vector}
            for index, vector in enumerate(vectors)
        ],
        "usage": {
            "prompt_tokens": sum(len(text) for text in texts),
            "total_tokens": sum(len(text) for text in texts),
        },
    }


def main() -> None:
    args = parse_args()
    EmbeddingHandler.model = load_model(args.model_dir)
    server = ThreadingHTTPServer((args.host, args.port), EmbeddingHandler)
    print(f"local embedding server ready: http://{args.host}:{args.port}/v1/embeddings", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
