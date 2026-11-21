/**
 * Random ids for code the browser runs. `crypto.randomUUID` is only there in a
 * secure context: open the app by plain `http://` on another machine and it is
 * missing, which is no reason for a page to fail. The fallback draws its bytes
 * the same way and sets the uuid's version and variant, so the result is still
 * a uuid (it is an id, never a secret).
 */

export function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
