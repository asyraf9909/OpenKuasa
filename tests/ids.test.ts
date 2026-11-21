import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@/lib/ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  afterEach(() => vi.restoreAllMocks());

  it('makes a uuid', () => {
    expect(newId()).toMatch(UUID);
  });

  it('still makes one where the browser has no randomUUID, as on plain http', () => {
    // `randomUUID` is gone but `getRandomValues` is not: exactly what plain http leaves.
    vi.spyOn(globalThis.crypto as { randomUUID?: unknown }, 'randomUUID', 'get').mockReturnValue(undefined);
    expect((globalThis.crypto as { randomUUID?: unknown }).randomUUID).toBeUndefined();
    const first = newId();
    expect(first).toMatch(UUID);
    expect(newId()).not.toBe(first);
  });
});
