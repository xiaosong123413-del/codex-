/**
 * MiniMax LLM provider implementation.
 *
 * MiniMax's current Messages API uses Anthropic's wire protocol at
 * `/anthropic` and authenticates with `Authorization: Bearer`, not
 * Anthropic's native `x-api-key` header. Reuse the Anthropic provider
 * transport with `authToken` so the SDK emits bearer auth.
 */

import { AnthropicProvider } from "./anthropic.js";

/** MiniMax API base URL. */
const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic";

/** MiniMax-backed LLM provider using Anthropic Messages wire format. */
export class MiniMaxProvider extends AnthropicProvider {
  constructor(model: string, apiKey: string, baseURL: string = MINIMAX_BASE_URL) {
    super(model, { authToken: apiKey, baseURL });
  }
}
