/**
 * LLM abstraction — the swappable "brain" behind the guarded agent.
 *
 * TradeGuard is a tool other people run, so both the **platform** (which API
 * gateway) and the **model** (which LLM) must be replaceable without touching the
 * guard. This module is that seam: `createLlm()` returns a `{ model, streamFn }`
 * pair you hand straight to a pi `Agent`. The guard hooks are unaffected — they sit
 * on the tool-call path regardless of which brain is chosen.
 *
 * A "platform" is just an OpenAI-compatible endpoint descriptor (base URL + api
 * flavor + where to read the key). Built-ins cover DMX, OpenAI and DeepSeek; a
 * downstream user swaps model with a string, swaps platform by name, or passes a
 * whole custom `LlmPlatform` object — no code change here required.
 *
 *   const llm = createLlm({ platform: "dmx", model: "claude-haiku-4-5-20251001" });
 *   new Agent({ streamFn: llm.streamFn, initialState: { model: llm.model, ... }, ...guard });
 *
 * Keys are read from env (never hardcoded). DMX: set `DMX_API_KEY`.
 */
import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { Api, Model, ModelCost } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";

/** An OpenAI-compatible LLM gateway. Add your own or pass one to `createLlm`. */
export interface LlmPlatform {
  /** Registry key / label, e.g. "dmx". */
  id: string;
  /** OpenAI-compatible base URL, e.g. "https://www.dmxapi.com/v1". */
  baseUrl: string;
  /** pi API flavor. Default "openai-completions" (what DMX/OpenAI/DeepSeek speak). */
  api?: Api;
  /** Provider id label forwarded to pi. Defaults to `id`. */
  provider?: string;
  /** Env var to read the key from. */
  apiKeyEnv?: string;
  /** Model used when the caller doesn't name one. */
  defaultModel?: string;
  contextWindow?: number;
  maxTokens?: number;
}

/** Built-in platforms. Downstream code may mutate this or pass its own descriptor. */
export const PLATFORMS: Record<string, LlmPlatform> = {
  dmx: {
    id: "dmx",
    baseUrl: "https://www.dmxapi.com/v1",
    api: "openai-completions",
    provider: "dmx",
    apiKeyEnv: "DMX_API_KEY",
    defaultModel: "gpt-4o-mini",
  },
  openai: {
    id: "openai",
    baseUrl: "https://api.openai.com/v1",
    api: "openai-completions",
    provider: "openai",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
  },
  deepseek: {
    id: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    api: "openai-completions",
    provider: "deepseek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
  },
};

export interface CreateLlmOptions {
  /** Platform name from `PLATFORMS`, or a custom `LlmPlatform`. Default "dmx". */
  platform?: string | LlmPlatform;
  /** Model id. Overrides the platform default. */
  model?: string;
  /** API key. Overrides the env var. */
  apiKey?: string;
  /** Base URL. Overrides the platform's. */
  baseUrl?: string;
  contextWindow?: number;
  maxTokens?: number;
}

export interface Llm {
  /** pi Model descriptor — put on `Agent` initialState. */
  model: Model<any>;
  /** pi stream function with the key bound in — put on `Agent`. */
  streamFn: StreamFn;
  /** The resolved platform (for logging). */
  platform: LlmPlatform;
  /** The resolved model id. */
  modelId: string;
}

const ZERO_COST: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Build a `{ model, streamFn }` pair for the chosen platform + model. */
export function createLlm(opts: CreateLlmOptions = {}): Llm {
  const platform = resolvePlatform(opts.platform);
  const apiKey = opts.apiKey ?? (platform.apiKeyEnv ? process.env[platform.apiKeyEnv] : undefined);
  if (!apiKey) {
    throw new Error(
      `No API key for platform "${platform.id}". Set ${platform.apiKeyEnv ?? "the platform key"} in the environment, or pass { apiKey }.`,
    );
  }
  const modelId = opts.model ?? platform.defaultModel;
  if (!modelId) throw new Error(`No model for platform "${platform.id}". Pass { model: "…" }.`);

  const model: Model<any> = {
    id: modelId,
    name: modelId,
    api: platform.api ?? "openai-completions",
    provider: platform.provider ?? platform.id,
    baseUrl: opts.baseUrl ?? platform.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow: opts.contextWindow ?? platform.contextWindow ?? 128_000,
    maxTokens: opts.maxTokens ?? platform.maxTokens ?? 4096,
  };

  // Bind the key into every request; base URL rides on the model.
  const streamFn: StreamFn = (m, context, options) =>
    streamSimple(m, context, { ...(options ?? {}), apiKey });

  return { model, streamFn, platform, modelId };
}

function resolvePlatform(p?: string | LlmPlatform): LlmPlatform {
  if (!p) return PLATFORMS.dmx;
  if (typeof p !== "string") return p;
  const found = PLATFORMS[p];
  if (!found) {
    throw new Error(
      `Unknown platform "${p}". Known: ${Object.keys(PLATFORMS).join(", ")} — or pass an LlmPlatform object.`,
    );
  }
  return found;
}
