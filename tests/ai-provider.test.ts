import { describe, expect, it } from 'vitest';
import {
  getWorkspaceModelById,
  hasProviderKey,
  pickModelId,
  platformApiKey,
  providerBaseUrl,
} from '@/lib/ai/provider';

describe('pickModelId', () => {
  it('uses the per-layer env var when set', () => {
    const env = {
      OPENKUASA_MODEL_ORCHESTRATOR: 'anthropic/claude-opus-4.5',
      OPENKUASA_MODEL_WORKER: 'openai/gpt-4o-mini',
    };
    expect(pickModelId('orchestrator', env)).toBe('anthropic/claude-opus-4.5');
    expect(pickModelId('worker', env)).toBe('openai/gpt-4o-mini');
  });

  it('falls back to a current default when the env var is unset or blank', () => {
    expect(pickModelId('orchestrator', {})).toBe('anthropic/claude-sonnet-4.5');
    expect(pickModelId('worker', { OPENKUASA_MODEL_WORKER: '   ' })).toBe('anthropic/claude-haiku-4.5');
  });
});

describe('providerBaseUrl', () => {
  it('adds /v1 to a bare host, which is how LiteLLM is usually named', () => {
    expect(providerBaseUrl({ LITELLM_BASE_URL: 'http://litellm:4000' })).toBe('http://litellm:4000/v1');
    expect(providerBaseUrl({ LITELLM_BASE_URL: 'http://litellm:4000/' })).toBe('http://litellm:4000/v1');
  });

  it('leaves a full path as given, so a gateway in front of LiteLLM keeps its own route', () => {
    expect(providerBaseUrl({ LITELLM_BASE_URL: 'https://proxy.example.com/v1' })).toBe('https://proxy.example.com/v1');
    expect(providerBaseUrl({ LITELLM_BASE_URL: 'https://gw.example.com/ai/v2' })).toBe('https://gw.example.com/ai/v2');
  });

  it('reads OPENAI_BASE_URL too, and falls back to LiteLLM’s own port', () => {
    expect(providerBaseUrl({ OPENAI_BASE_URL: 'http://localhost:8000' })).toBe('http://localhost:8000/v1');
    expect(providerBaseUrl({})).toBe('http://localhost:4000/v1');
    expect(providerBaseUrl({ LITELLM_BASE_URL: 'http://a:1', OPENAI_BASE_URL: 'http://b:2' })).toBe('http://a:1/v1');
  });
});

describe('getWorkspaceModelById', () => {
  it('is the model that was named, with no fallback, and is built without a platform key', () => {
    const before = process.env.LITELLM_API_KEY;
    delete process.env.LITELLM_API_KEY;
    try {
      const model = getWorkspaceModelById(' some/vision-model ', 'sk-workspace') as { modelId?: string };
      expect(model.modelId).toBe('some/vision-model');
    } finally {
      if (before !== undefined) process.env.LITELLM_API_KEY = before;
    }
  });

  it('refuses an empty key or an empty id, so it can never fall through to another key or model', () => {
    expect(() => getWorkspaceModelById('some/model', '  ')).toThrow();
    expect(() => getWorkspaceModelById('  ', 'sk-workspace')).toThrow();
  });
});

describe('hasProviderKey', () => {
  it('is true when either the LiteLLM key or an OpenAI-compatible key is set', () => {
    expect(hasProviderKey({ LITELLM_API_KEY: 'sk-litellm' })).toBe(true);
    expect(hasProviderKey({ OPENAI_API_KEY: 'sk-openai' })).toBe(true);
    expect(hasProviderKey({ LITELLM_API_KEY: '  ', OPENAI_API_KEY: 'sk-openai' })).toBe(true);
    expect(hasProviderKey({ LITELLM_API_KEY: '' })).toBe(false);
    expect(hasProviderKey({})).toBe(false);
  });

  it('prefers the LiteLLM key, which is the proxy’s own', () => {
    expect(platformApiKey({ LITELLM_API_KEY: 'sk-litellm', OPENAI_API_KEY: 'sk-openai' })).toBe('sk-litellm');
    expect(platformApiKey({ OPENAI_API_KEY: 'sk-openai' })).toBe('sk-openai');
    expect(platformApiKey({})).toBeNull();
  });
});
