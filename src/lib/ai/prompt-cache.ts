/**
 * Marks a system prompt for the provider to cache.
 *
 * An assistant's prompt is the same on every call of a turn, and on every turn
 * for a few minutes after. Marked this way, a model that supports it (the
 * Anthropic models, which LiteLLM passes the mark to) bills the repeated prompt,
 * and the tool list sent before it, at a fraction of the usual price; a model
 * that does not support it ignores the mark.
 *
 * Only what is word for word the same from one call to the next may be marked.
 * A prompt that carries the time of day would be written to the cache on every
 * call and never read back, which costs more than not caching. So a prompt that
 * ends with a dated part is given with its fixed part (`fixed`): the fixed part
 * is marked and the rest follows it as a message of its own, unmarked.
 *
 * The mark is left on the message as `cacheControl`, which the OpenAI-compatible
 * request carries through untouched. `provider.ts` turns it into the
 * `cache_control` breakpoint on a content block before the request is sent, which
 * is the shape LiteLLM hands to a model that takes one; a model that does not
 * (an OpenAI one, say) ignores the breakpoint.
 */
import type { SystemModelMessage } from 'ai';

const MARK = { openaiCompatible: { cacheControl: { type: 'ephemeral' } } } as const;

/** A prompt that never changes: one marked message. */
export function cachedInstructions(prompt: string): SystemModelMessage;
/** A prompt that begins with `fixed` and ends with something that changes: the fixed part marked, the rest after it. */
export function cachedInstructions(prompt: string, fixed: string): SystemModelMessage | SystemModelMessage[];
export function cachedInstructions(prompt: string, fixed?: string): SystemModelMessage | SystemModelMessage[] {
  if (fixed === undefined) return { role: 'system', content: prompt, providerOptions: MARK };
  // Not the shape that was promised: nothing is marked, so nothing that changes can reach the cache.
  if (!fixed || !prompt.startsWith(fixed)) return { role: 'system', content: prompt };
  const rest = prompt.slice(fixed.length).replace(/^\n+/, '');
  const marked: SystemModelMessage = { role: 'system', content: fixed, providerOptions: MARK };
  return rest ? [marked, { role: 'system', content: rest }] : marked;
}
