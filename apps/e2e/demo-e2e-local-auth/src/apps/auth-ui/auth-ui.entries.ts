/**
 * Custom auth-UI handlers for the auth-UI E2E (#469 — map form).
 *
 * There is NO decorator and NO class anymore: the custom login slot is declared
 * as `auth.ui: { login: './…/login.tsx' }` on the server config (a relative path
 * auto-anchored to that config file), and the extra is a plain
 * `AuthExtraHandler` function keyed by name in `auth.extras`.
 */
import { type AuthExtraContext } from '@frontmcp/sdk';

/**
 * Validates an env-var submission: requires a non-empty `key`, rejects
 * duplicates already in the accumulator, and accepts `{ key, value }`.
 */
export function addEnvExtra(input: Record<string, unknown>, ctx: AuthExtraContext) {
  const key = typeof input['key'] === 'string' ? (input['key'] as string).trim() : '';
  if (!key) {
    return { ok: false as const, error: 'key is required' };
  }
  const already = ctx.current.some((it) => (it as { key?: string })?.key === key);
  if (already) {
    return { ok: false as const, error: `"${key}" was already added` };
  }
  const value = typeof input['value'] === 'string' ? input['value'] : '';
  return { ok: true as const, addedItems: [{ key, value }], sideEffects: { count: ctx.current.length + 1 } };
}
