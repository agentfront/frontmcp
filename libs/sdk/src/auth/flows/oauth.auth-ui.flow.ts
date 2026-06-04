/**
 * Auth-UI serving flow (#469 — esm.sh import-map + server-side transform).
 *
 * ONE HTTP endpoint backs custom `@AuthUi` pages, registered alongside the OAuth
 * flows in {@link LocalPrimaryAuth.registerAuthFlows}:
 *
 *  - `POST ${fullPath}/oauth/ui/extra` — routes an `@AuthExtra(name)` submission
 *    (the `action` field names the extra) to the registered validator, persists
 *    accepted items into the per-pending-auth accumulator, and returns the
 *    contract JSON `{ ok, error?, addedItems?, sideEffects? }`. CSRF is verified
 *    against the token minted at SSR time (reject 400 on mismatch).
 *
 * There is NO `GET /oauth/ui/:slot.js` route anymore — the component is
 * TRANSFORMED server-side and INLINED into the authorize/callback page as a
 * `<script type="module">` (deps from esm.sh via an import-map), so there is no
 * separately-served bundle. The pages themselves are served by the existing
 * `/oauth/authorize` and `/oauth/callback` flows.
 *
 * This endpoint is a no-op (404) when no `@AuthExtra` is configured for the
 * scope, so the default behavior is unchanged.
 *
 * @packageDocumentation
 */
import { z } from '@frontmcp/lazy-zod';

import {
  Flow,
  FlowBase,
  httpInputSchema,
  HttpJsonSchema,
  httpRespond,
  StageHookOf,
  type FlowPlan,
  type FlowRunOptions,
} from '../../common';
import { type AuthUiRegistry } from '../auth-ui';
import { type LocalPrimaryAuth } from '../instances/instance.local-primary-auth';

// ════════════════════════════════════════════════════════════════════════════
// POST /oauth/ui/extra — @AuthExtra validated-field submit
// ════════════════════════════════════════════════════════════════════════════

const extraInputSchema = httpInputSchema;
const extraStateSchema = z.object({
  action: z.string().optional(),
  pendingAuthId: z.string().optional(),
  csrf: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
const extraOutputSchema = HttpJsonSchema;

const extraPlan = {
  pre: ['parseInput'],
  execute: ['handleExtra'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'oauth:auth-ui-extra': FlowRunOptions<
      OauthAuthUiExtraFlow,
      typeof extraPlan,
      typeof extraInputSchema,
      typeof extraOutputSchema,
      typeof extraStateSchema
    >;
  }
}

const extraName = 'oauth:auth-ui-extra' as const;
const ExtraStage = StageHookOf(extraName);

@Flow({
  name: extraName,
  plan: extraPlan,
  inputSchema: extraInputSchema,
  outputSchema: extraOutputSchema,
  access: 'public',
  middleware: {
    method: 'POST',
    path: '/oauth/ui/extra',
  },
})
export default class OauthAuthUiExtraFlow extends FlowBase<typeof extraName> {
  private logger = this.scope.logger.child('OauthAuthUiExtraFlow');

  @ExtraStage('parseInput')
  async parseInput() {
    const { request } = this.rawInput;
    const body = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;
    const query = (request.query ?? {}) as Record<string, unknown>;

    const readStr = (key: string): string | undefined => {
      const v = body[key] ?? query[key];
      return typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;
    };

    // The validated field payload is everything except the reserved control keys.
    // Use a null-prototype object and skip prototype-pollution keys so an
    // untrusted body (e.g. JSON with an own `__proto__` key) can't mutate the
    // object's prototype.
    const reserved = new Set(['action', 'pending_auth_id', 'csrf', '__proto__', 'constructor', 'prototype']);
    const payload: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(body)) {
      if (!reserved.has(k)) payload[k] = v;
    }

    this.state.set({
      action: readStr('action'),
      pendingAuthId: readStr('pending_auth_id'),
      csrf: readStr('csrf'),
      payload,
    });
  }

  @ExtraStage('handleExtra')
  async handleExtra() {
    const { action, pendingAuthId, csrf, payload } = this.state;
    const authUi: AuthUiRegistry | undefined = this.scope.authUi;

    if (!authUi || !authUi.hasExtras()) {
      this.respond(httpRespond.json({ ok: false, error: 'No extras are configured.' }, { status: 404 }));
      return;
    }

    if (!action || !authUi.hasExtra(action)) {
      this.respond(httpRespond.json({ ok: false, error: `Unknown extra "${action ?? ''}".` }, { status: 400 }));
      return;
    }

    // CSRF: verify against the token minted at SSR time. Check the persisted
    // pending-record token first (cross-node), then the in-memory registry.
    const ok = await this.verifyExtraCsrf(pendingAuthId, csrf, authUi);
    if (!ok) {
      this.logger.warn('Auth-UI extra CSRF mismatch');
      this.respond(httpRespond.json({ ok: false, error: 'Invalid or missing CSRF token' }, { status: 400 }));
      return;
    }

    const result = await authUi.runExtra(action, pendingAuthId, payload ?? {});
    this.respond(httpRespond.json(result, { status: result.ok ? 200 : 400 }));
  }

  /** Verify the extra's CSRF token against the pending record + registry. */
  private async verifyExtraCsrf(
    pendingAuthId: string | undefined,
    submitted: string | undefined,
    authUi: AuthUiRegistry,
  ): Promise<boolean> {
    if (!pendingAuthId || !submitted) return false;
    // Prefer the persisted token (survives across nodes); fall back to registry.
    try {
      const localAuth = this.scope.auth as LocalPrimaryAuth;
      const record = await localAuth.authorizationStore.getPendingAuthorization(pendingAuthId);
      if (record?.authUiCsrf) {
        return timingSafeEqualStr(record.authUiCsrf, submitted);
      }
    } catch {
      // Fall through to the in-memory registry check.
    }
    return authUi.verifyCsrf(pendingAuthId, submitted);
  }
}

/** Constant-time string compare to avoid timing oracles on the CSRF token. */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
