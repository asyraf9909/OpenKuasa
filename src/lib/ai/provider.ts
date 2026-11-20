/**
 * LLM provider factory for the Ask-Jebat agent.
 *
 * Provider-agnostic by design (AGPL self-hosters swap with env alone): every
 * call goes to a LiteLLM proxy, which speaks the OpenAI-compatible API and
 * routes a model name to whichever provider serves it. The model is chosen
 * *per layer* so the orchestrator can run a strong model while sub-agents run a
 * cheap/fast one.
 *
 * The provider instance is created lazily, so importing this module never throws
 * when the endpoint or key is unset (keeps builds and unit tests key-free).
 */

import 'server-only';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export type AgentLayer = 'orchestrator' | 'worker';

/** Fallbacks used only when the per-layer env var is unset. Override via env; each is a deployment name in LiteLLM. */
const FALLBACK_MODEL: Record<AgentLayer, string> = {
  orchestrator: 'anthropic/claude-sonnet-4.5',
  worker: 'anthropic/claude-haiku-4.5',
};

type EnvLike = Record<string, string | undefined>;

/** Where LiteLLM's proxy listens when nothing names another endpoint (its own default port). */
const DEFAULT_BASE_URL = 'http://localhost:4000';

/**
 * The OpenAI-compatible base URL every call is posted to. LiteLLM's own routes
 * live under `/v1`, so that is added when the configured value names the proxy
 * rather than a path (`http://litellm:4000` → `…/v1`); a value that already
 * ends in a version (`…/v1`) or names a deeper path is used as given, which is
 * what a gateway in front of LiteLLM needs.
 */
export function providerBaseUrl(env: EnvLike = process.env): string {
  const raw = (env.LITELLM_BASE_URL?.trim() || env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return /\/v\d+$/.test(raw) ? raw : `${raw}/v1`;
}

/**
 * The platform key: LiteLLM's master key or a virtual key for the platform's
 * own spend. `OPENAI_API_KEY` is read as well, because that is the variable an
 * OpenAI-compatible endpoint is usually handed. Null when neither is set.
 */
export function platformApiKey(env: EnvLike = process.env): string | null {
  return env.LITELLM_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || null;
}

/** Pure model-id resolution (env → fallback), extracted for unit testing. */
export function pickModelId(layer: AgentLayer, env: EnvLike = process.env): string {
  const fromEnv =
    layer === 'orchestrator'
      ? env.OPENKUASA_MODEL_ORCHESTRATOR
      : env.OPENKUASA_MODEL_WORKER;
  return fromEnv?.trim() || FALLBACK_MODEL[layer];
}

/** True when a provider key is configured — lets the route return a clean 503 instead of crashing. */
export function hasProviderKey(env: EnvLike = process.env): boolean {
  return platformApiKey(env) !== null;
}

/**
 * Moves each message's cache mark onto its last text block, as `cache_control`.
 *
 * The AI SDK spreads a message's `providerOptions.openaiCompatible` into the
 * message itself, so the mark leaves as `{ role, content, cacheControl }`. LiteLLM
 * reads a breakpoint from a content block (`cache_control` on a `text` part) and
 * ignores a field beside the role, so the mark is moved there: the content becomes
 * a block array with the last text block marked. A model without prompt caching
 * ignores the breakpoint; a request with no mark is left exactly as it was.
 */
function withCacheBreakpoints(body: Record<string, unknown>): Record<string, unknown> {
  const messages = body.messages;
  if (!Array.isArray(messages)) return body;
  let marked = false;
  const moved = messages.map((message: unknown) => {
    if (!message || typeof message !== 'object') return message;
    const { cacheControl, ...rest } = message as Record<string, unknown>;
    if (!cacheControl || typeof cacheControl !== 'object') return message;
    marked = true;
    const content = rest.content;
    const blocks: Record<string, unknown>[] =
      typeof content === 'string'
        ? [{ type: 'text', text: content }]
        : Array.isArray(content)
          ? content.map((block: unknown) => ({ ...(block as Record<string, unknown>) }))
          : [];
    // The breakpoint goes on the last text block, which is the end of what is cached.
    const last = blocks.map((block) => block.type).lastIndexOf('text');
    if (last === -1) return { ...rest, content, cache_control: cacheControl };
    blocks[last] = { ...blocks[last], cache_control: cacheControl };
    return { ...rest, content: blocks };
  });
  return marked ? { ...body, messages: moved } : body;
}

function createProvider(apiKey: string) {
  return createOpenAICompatible({
    name: 'litellm',
    apiKey,
    baseURL: providerBaseUrl(),
    transformRequestBody: withCacheBreakpoints,
  });
}

/**
 * A model of `provider` under the id the caller named. LiteLLM takes the model
 * name from the request itself, so the id is passed through as given: the same
 * name the proxy's `model_list` holds.
 */
const named = (provider: ReturnType<typeof createOpenAICompatible>, modelId: string): LanguageModel =>
  provider(modelId);

let platformProvider: ReturnType<typeof createOpenAICompatible> | null = null;

function getPlatformProvider() {
  const apiKey = platformApiKey();
  if (!apiKey) {
    throw new Error('No AI key is set (LITELLM_API_KEY) — chat cannot reach the model.');
  }
  platformProvider ??= createProvider(apiKey);
  return platformProvider;
}

/**
 * The model for a given agent layer. Pass a workspace's own key to bill that
 * workspace (bring-your-own-key); omit it to use the platform key.
 */
export function getModel(layer: AgentLayer, apiKey?: string): LanguageModel {
  // A workspace provider is built per request so keys are never cached.
  const provider = apiKey ? createProvider(apiKey) : getPlatformProvider();
  return named(provider, pickModelId(layer));
}

/**
 * A model named by the caller, on a workspace's own key and never the
 * platform's: for a feature that takes its model id from its own environment
 * variable and has no fallback id in code (reading a receipt). An empty key or
 * id is refused rather than handed to the provider.
 */
export function getWorkspaceModelById(modelId: string, apiKey: string): LanguageModel {
  if (!apiKey.trim() || !modelId.trim()) throw new Error('A workspace model needs a key and a model id.');
  // Built per request so keys are never cached.
  return named(createProvider(apiKey), modelId.trim());
}
