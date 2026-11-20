// tests/ai-provider-session.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { getModel, pickModelId, providerBaseUrl } from '@/lib/ai/provider';

type Posted = { url: string; method: string; body: Record<string, unknown> };

/** What `getModel`'s calls post to the LiteLLM proxy, read from a stand-in for fetch. */
async function posted(layer: 'orchestrator' | 'worker', apiKey = 'sk-test'): Promise<Posted> {
  let captured: Posted = { url: '', method: '', body: {} };
  vi.stubGlobal('fetch', async (url: unknown, init: { method?: string; body?: string }) => {
    captured = { url: String(url), method: init.method ?? 'POST', body: JSON.parse(init.body ?? '{}') as Record<string, unknown> };
    return new Response(
      JSON.stringify({
        id: 'gen-1', model: 'm', created: 0, object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  await generateText({ model: getModel(layer, apiKey), prompt: 'hi' });
  return captured;
}

afterEach(() => vi.unstubAllGlobals());

describe('getModel', () => {
  it('posts the model the layer names to the proxy’s chat route', async () => {
    const { url, body } = await posted('orchestrator');
    expect(url).toBe(`${providerBaseUrl()}/chat/completions`);
    expect(body.model).toBe(pickModelId('orchestrator'));
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('sends nothing OpenRouter-style, which the proxy would refuse', async () => {
    const { body } = await posted('orchestrator');
    expect(body.session_id).toBeUndefined();
    expect(body.provider).toBeUndefined();
    expect(body.transforms).toBeUndefined();
  });
});

describe('a prompt marked for the cache', () => {
  it('goes as a cache_control breakpoint on the content block, which is the shape LiteLLM reads', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: unknown, init: { body?: string }) => {
      body = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          id: 'gen-1', model: 'm', created: 0, object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    await generateText({
      model: getModel('orchestrator', 'sk-test'),
      system: {
        role: 'system',
        content: 'You are Tuah.',
        providerOptions: { openaiCompatible: { cacheControl: { type: 'ephemeral' } } },
      },
      prompt: 'hi',
    });
    const messages = body.messages as Record<string, unknown>[];
    const system = messages.find((m) => m.role === 'system')!;
    expect(system.cacheControl).toBeUndefined();
    expect(system.content).toEqual([{ type: 'text', text: 'You are Tuah.', cache_control: { type: 'ephemeral' } }]);
    // The user's turn is not marked: only the prompt that never changes is.
    const user = messages.find((m) => m.role === 'user') as { content: unknown };
    expect(JSON.stringify(user.content)).not.toContain('cache_control');
  });

  it('leaves a request with no mark untouched', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: unknown, init: { body?: string }) => {
      body = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          id: 'gen-1', model: 'm', created: 0, object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    await generateText({ model: getModel('orchestrator', 'sk-test'), prompt: 'hi' });
    expect((body.messages as { content: unknown }[])[0].content).toBe('hi');
  });
});
