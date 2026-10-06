/**
 * Key prefixing for the stores that take a `keyPrefix` (Redis, Vercel KV).
 *
 * The Remember accessor hands a store keys that already start with the plugin's `keyPrefix`
 * (`remember:v2:user:…`), and the plugin gives the store the same prefix. Up to 1.9.1 the store
 * added it again, so entries lived under `remember:remember:v2:user:…` (#767). A key that already
 * carries the prefix is now stored as is, and the doubled key is where such an entry may still be.
 */

/** The backend key for a store key. */
export function prefixedStoreKey(keyPrefix: string, key: string): string {
  return keyPrefix && key.startsWith(keyPrefix) ? key : keyPrefix + key;
}

/** Where releases up to 1.9.1 stored a key that carries the prefix: with the prefix twice. */
export function doubledPrefixKey(keyPrefix: string, key: string): string | undefined {
  return keyPrefix && key.startsWith(keyPrefix) ? keyPrefix + key : undefined;
}

/** A backend key found by `keys(pattern)`, as the caller names it. */
export function callerKeyOf(keyPrefix: string, pattern: string, backendKey: string): string {
  return keyPrefix && pattern.startsWith(keyPrefix) ? backendKey : backendKey.slice(keyPrefix.length);
}

/**
 * Sets KEYS[1] to ARGV[1], with ARGV[2] seconds of TTL when it is not empty, unless KEYS[1] or KEYS[2]
 * exists. Run as one script, a value still under the doubled key keeps a conditional write out.
 */
export const SET_IF_NEITHER_KEY_EXISTS_SCRIPT = `
if redis.call('EXISTS', KEYS[1], KEYS[2]) > 0 then return 0 end
if ARGV[2] ~= '' then redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2]) else redis.call('SET', KEYS[1], ARGV[1]) end
return 1
`;
