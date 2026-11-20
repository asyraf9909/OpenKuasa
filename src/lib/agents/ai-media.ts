/**
 * The LiteLLM media seam for the autonomous agent worker.
 *
 * Every generation call lives behind a named async function that takes the ORG's
 * already-decrypted AI key as its first param. This module never reads or
 * decrypts keys and never logs them. It is the ONE module agent/runner unit tests
 * mock, so CI never spends money. Importing it is key-free (providers are built
 * per call).
 *
 * The endpoint is LiteLLM's OpenAI-compatible API: chat for text and the digests,
 * `/images/generations` for a picture, `/videos` for a clip, and its cost header
 * for what a call cost.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateImage as aiGenerateImage, generateText } from 'ai';
import { usdToCents } from '@/lib/agents/costs';
import { providerBaseUrl } from '@/lib/ai/provider';

/**
 * `cost_cents` is what the provider reported for the call, in whole cents, or `null`
 * when it reported nothing. `null` is NOT zero: the caller counts such a step at its
 * estimate (see costs.ts) so the spend caps never read an unreported cost as free.
 */
export type DigestResult = { text: string; cost_cents: number | null };
export type ImageResult = { bytes: Uint8Array; contentType: string; cost_cents: number | null };
export type VideoStart = { jobId: string; cost_cents: number | null };
export type VideoCheck = {
  status: 'pending' | 'done' | 'failed';
  /** Where the finished clip is fetched from; absent while it is still rendering. */
  url?: string;
  /** Reported once the job has ended; absent while it is still rendering. */
  cost_cents?: number | null;
};

/** Fallback names; override via env so self-hosters can swap models. Each is a deployment name in LiteLLM. */
const SEARCH_MODEL = () => process.env.OPENKUASA_MODEL_AGENT_SEARCH?.trim() || 'perplexity/sonar';
export const DIGEST_MODEL = () =>
  process.env.OPENKUASA_MODEL_AGENT_DIGEST?.trim() || 'anthropic/claude-sonnet-4.5';
const IMAGE_MODEL = () =>
  process.env.OPENKUASA_MODEL_AGENT_IMAGE?.trim() || 'google/gemini-2.5-flash-image';
const VIDEO_MODEL = () =>
  process.env.OPENKUASA_MODEL_AGENT_VIDEO?.trim() || 'sora-2';

function provider(apiKey: string) {
  return createOpenAICompatible({ name: 'litellm', apiKey, baseURL: providerBaseUrl() });
}

/**
 * The cost LiteLLM says it spent on the call (`x-litellm-response-cost`, in USD),
 * or null when it says nothing. A body-carried figure is read too, for a proxy
 * that reports it there instead of in the header.
 */
function costOf(headers: Record<string, string> | undefined, body?: unknown): number | null {
  const fromHeader = headers?.['x-litellm-response-cost'];
  if (fromHeader !== undefined) {
    const cents = usdToCents(Number(fromHeader));
    if (cents !== null) return cents;
  }
  const usage = (body as { usage?: { cost?: unknown } } | null | undefined)?.usage?.cost;
  return usdToCents(typeof usage === 'string' ? Number(usage) : usage);
}

/** Response headers as a plain lower-case object, so a header is read the same way everywhere. */
const headersOf = (res: Response): Record<string, string> =>
  Object.fromEntries([...res.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));

export async function complete(apiKey: string, modelId: string, prompt: string): Promise<DigestResult> {
  const { text, response } = await generateText({
    model: provider(apiKey)(modelId),
    prompt,
  });
  return { text, cost_cents: costOf(response.headers) };
}

/** Web-grounded research. Uses a search-native model; name another via env to ground it instead. */
export async function webSearch(apiKey: string, query: string): Promise<DigestResult> {
  return complete(apiKey, SEARCH_MODEL(), query);
}

export async function writeDigest(apiKey: string, context: string): Promise<DigestResult> {
  return complete(apiKey, DIGEST_MODEL(), context);
}

/**
 * Asks the model WHICH of the given candidate changes to queue for owner approval,
 * with a one-line rationale each. It only sees `{ index, title }` (never raw ids) and
 * can only select indexes; it cannot invent actions or inputs. The caller re-validates
 * every selection server-side, so malformed or hostile output is simply dropped.
 */
export async function suggestProposals(
  apiKey: string,
  prompt: string,
): Promise<{ keep: { index: number; rationale: string; name?: string }[]; cost_cents: number | null }> {
  const { text, cost_cents } = await complete(apiKey, DIGEST_MODEL(), prompt);
  const keep: { index: number; rationale: string; name?: string }[] = [];
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed: unknown = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const { index, rationale, name } = (item ?? {}) as {
            index?: unknown;
            rationale?: unknown;
            name?: unknown;
          };
          if (typeof index === 'number' && Number.isInteger(index) && typeof rationale === 'string') {
            const named = typeof name === 'string' && name.trim() ? { name: name.trim() } : {};
            keep.push({ index, rationale: rationale.trim(), ...named });
          }
        }
      }
    } catch {
      // Unparseable model output: select nothing.
    }
  }
  return { keep, cost_cents };
}

export async function generateImage(apiKey: string, prompt: string): Promise<ImageResult> {
  const result = await aiGenerateImage({
    model: provider(apiKey).imageModel(IMAGE_MODEL()),
    prompt,
  });
  const image = result.image;
  return {
    bytes: image.uint8Array,
    contentType: image.mediaType || 'image/png',
    // The headers of the call that made it, beside the image itself.
    cost_cents: costOf(result.calls[0]?.response.headers),
  };
}

type VideoSubmit = { id?: string };
type VideoPoll = { status?: string; url?: unknown };

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

/** A video route under the OpenAI-compatible base (`…/v1/videos`), as LiteLLM serves it. */
const videoUrl = (suffix = '') => `${providerBaseUrl()}/videos${suffix}`;

/** Starts an async video job and returns its id; poll with checkVideo. */
export async function startVideo(apiKey: string, prompt: string): Promise<VideoStart> {
  const res = await fetch(videoUrl(), {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ model: VIDEO_MODEL(), prompt }),
  });
  if (!res.ok) throw new Error(`AI video start failed (${res.status}).`);
  const json = (await res.json()) as VideoSubmit;
  if (!json.id) throw new Error('AI video start returned no job id.');
  // The cost is only known once the job has ended, so a submitted job usually
  // reports none (null): the caller books an estimate now and checkVideo settles it.
  return { jobId: json.id, cost_cents: costOf(headersOf(res)) };
}

export async function checkVideo(apiKey: string, jobId: string): Promise<VideoCheck> {
  const id = encodeURIComponent(jobId);
  const res = await fetch(videoUrl(`/${id}`), { headers: authHeaders(apiKey) });
  if (!res.ok) throw new Error(`AI video status failed (${res.status}).`);
  const json = (await res.json()) as VideoPoll;
  const cost_cents = costOf(headersOf(res));
  if (json.status === 'completed') {
    // LiteLLM serves a finished clip's bytes by id; a proxy that names a link in the
    // record is followed instead.
    const url = typeof json.url === 'string' && json.url ? json.url : videoUrl(`/${id}/content`);
    return { status: 'done', url, cost_cents };
  }
  if (['failed', 'dead', 'cancelled', 'expired', 'error'].includes(json.status ?? '')) {
    return { status: 'failed', cost_cents };
  }
  return { status: 'pending' };
}
