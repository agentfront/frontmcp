/**
 * Auth-UI Registry (#469 — slot→file map + name→handler map).
 *
 * Built per OAuth scope from the scope's resolved auth options:
 *  - `auth.ui` — a {@link AuthSlot} → relative `.tsx`/`.jsx` PATH map, and
 *  - `auth.extras` — an extra-name → server HANDLER function map.
 *
 * It resolves each slot's file against the scope's captured source directory
 * (the `@FrontMcp`/`@App` `__sourceDir`; absolute paths pass through) and owns
 * the cross-cutting SERVER-side concerns the client contract delegates to the
 * server:
 *  - CSRF minting + verifying (per pending-auth id),
 *  - the per-(pending-auth, extra) ACCUMULATOR that backs `useAddedItems(name)`,
 *  - the per-slot {@link AuthUiFileSource} the page builder transpiles.
 *
 * The auth pages render ENTIRELY in the browser from a server-side single-file
 * TRANSFORM routed through `@frontmcp/uipack`'s pluggable `renderComponent`: the
 * slot's `.tsx` is transpiled with esbuild `transformSync` (deps stay external)
 * and inlined as a `<script type="module">`, with react / react-dom /
 * `@frontmcp/ui/auth` loaded from esm.sh via an import-map. The server NEVER
 * imports, bundles, or evaluates the component — no IIFE bundle, no served `.js`.
 *
 * When NO file is registered for a slot, the flows fall back to the built-in
 * HTML pages unchanged (the no-config default). No PII is stored — the
 * accumulator holds whatever items the developer's extra handler accepted
 * (their responsibility), keyed by opaque pending-auth id.
 *
 * @packageDocumentation
 */
import { type AuthExtraContext, type AuthExtraHandler, type AuthExtraResult } from '@frontmcp/auth';
import { isAbsolute, pathResolve, randomBytes, sha256Hex } from '@frontmcp/utils';

import { type FrontMcpLogger } from '../../common';
import { type AuthSlot, type AuthUiFileSource } from './auth-ui.contract';

/** All five slots, used for validation. */
const ALL_SLOTS: readonly AuthSlot[] = ['login', 'consent', 'incremental', 'federated', 'error'] as const;

/**
 * The JSON returned to the client from an extra submit. Mirrors the client
 * `AuthExtraResult` shape — `addedItems` here is the FULL accumulator MAP keyed
 * by extra name (not the handler's per-call new-items list).
 */
export interface AuthExtraRunResult {
  ok: boolean;
  error?: string;
  addedItems?: Record<string, unknown[]>;
  sideEffects?: Record<string, unknown>;
}

/** Per-registered-slot state. */
interface SlotEntry {
  /** Resolved absolute path to the slot's `.tsx`/`.jsx` source. */
  file: string;
  /** A transform/build error, cached so a broken file isn't retried each request. */
  error?: string;
}

/** Per-pending-auth CSRF + accumulator state. */
interface PendingAuthUiState {
  csrf: string;
  /** Accumulators keyed by extra name. */
  addedItems: Record<string, unknown[]>;
  createdAt: number;
}

/** Default TTL for the in-memory pending-ui state (mirrors pending-auth: 10m). */
const PENDING_UI_TTL_MS = 10 * 60 * 1000;

/**
 * Registry of custom auth-UI slot files + extra handlers for a scope.
 */
export class AuthUiRegistry {
  private readonly slots = new Map<AuthSlot, SlotEntry>();
  private readonly extras = new Map<string, AuthExtraHandler>();
  private readonly pending = new Map<string, PendingAuthUiState>();
  private readonly logger?: FrontMcpLogger;
  /**
   * Optional per-specifier resolver overrides applied when building the page's
   * import-map (e.g. mapping `@frontmcp/ui/auth` to a locally-served ESM URL in
   * dev / offline, where it isn't on esm.sh).
   */
  private resolverOverrides?: Record<string, string>;

  constructor(logger?: FrontMcpLogger) {
    this.logger = logger?.child('AuthUiRegistry');
  }

  /**
   * Register the `auth.ui` slot→file map. Each relative path is resolved against
   * `sourceDir` (the declaring `@FrontMcp`/`@App` directory); absolute paths pass
   * through. Later registrations for the same slot win (so a scope can override a
   * server-level default).
   */
  registerAuthUiMap(map: Partial<Record<AuthSlot, string>> | undefined, sourceDir: string): void {
    if (!map) return;
    for (const [slotKey, rawPath] of Object.entries(map)) {
      const slot = slotKey as AuthSlot;
      if (!ALL_SLOTS.includes(slot)) {
        throw new Error(`auth.ui slot "${slot}" is not one of: ${ALL_SLOTS.join(', ')}.`);
      }
      if (typeof rawPath !== 'string' || rawPath.length === 0) continue;
      const file = isAbsolute(rawPath) ? rawPath : pathResolve(sourceDir, rawPath);
      this.slots.set(slot, { file });
      this.logger?.verbose(`Registered auth.ui slot "${slot}" → ${file}`);
    }
  }

  /**
   * Register the `auth.extras` name→handler map. Each value must be a function
   * `(input, ctx) => AuthExtraResult | Promise<AuthExtraResult>`.
   */
  registerAuthExtrasMap(map: Record<string, AuthExtraHandler> | undefined): void {
    if (!map) return;
    for (const [name, handler] of Object.entries(map)) {
      if (typeof handler !== 'function') {
        throw new Error(`auth.extras["${name}"] must be a handler function (input, ctx) => AuthExtraResult.`);
      }
      this.extras.set(name, handler);
      this.logger?.verbose(`Registered auth.extras handler "${name}"`);
    }
  }

  /**
   * Set per-specifier import-map overrides for the page builder. Use in dev /
   * offline to point `@frontmcp/ui/auth` (not on esm.sh in a monorepo) at a
   * locally-served ESM URL.
   */
  setResolverOverrides(overrides: Record<string, string> | undefined): void {
    this.resolverOverrides = overrides;
  }

  /** The configured import-map overrides (undefined when none). */
  getResolverOverrides(): Record<string, string> | undefined {
    return this.resolverOverrides;
  }

  /** Whether any custom slot file is registered. */
  hasAny(): boolean {
    return this.slots.size > 0;
  }

  /** Whether a custom file is registered for `slot`. */
  hasSlot(slot: AuthSlot): boolean {
    return this.slots.has(slot);
  }

  /** Whether any extra handler is registered. */
  hasExtras(): boolean {
    return this.extras.size > 0;
  }

  // ============================================
  // Slot source resolution (for the page builder)
  // ============================================

  /**
   * The file-based source for a slot, or `undefined` when the slot is
   * unregistered or previously failed to build (error cached). Used by the page
   * builder to transpile the `.tsx` server-side.
   */
  getSlotSource(slot: AuthSlot): AuthUiFileSource | undefined {
    const entry = this.slots.get(slot);
    if (!entry || entry.error) return undefined;
    return { file: entry.file };
  }

  /**
   * Whether a slot can be rendered — i.e. a file is registered for it (and it
   * hasn't recorded a build error). Used by the page assembler to decide between
   * the custom page and the built-in fallback.
   */
  canRenderSlot(slot: AuthSlot): boolean {
    return this.getSlotSource(slot) !== undefined;
  }

  /**
   * Record a transform/build error for a slot so a broken file isn't
   * re-transpiled on every request (the slot then falls back to the built-in
   * page). Called by the page builder when the transform throws.
   */
  recordSlotError(slot: AuthSlot, message: string): void {
    const entry = this.slots.get(slot);
    if (entry && !entry.error) {
      entry.error = message;
      this.logger?.error(`Failed to build auth.ui page for slot "${slot}": ${message}`);
    }
  }

  // ============================================
  // CSRF (server-owned)
  // ============================================

  /**
   * Mint (or reuse) the CSRF token for a pending-auth id and return it. The
   * token is stored server-side and echoed into {@link AuthFlowState.csrfToken}.
   */
  mintCsrf(pendingAuthId: string): string {
    const existing = this.pending.get(pendingAuthId);
    if (existing) return existing.csrf;
    const csrf = sha256Hex(randomBytes(32)).slice(0, 43);
    this.pending.set(pendingAuthId, { csrf, addedItems: {}, createdAt: Date.now() });
    this.pruneExpired();
    return csrf;
  }

  /**
   * Look up a pending-ui entry, enforcing the TTL at read time: an expired entry
   * is deleted and treated as absent. This guarantees a stale token can never
   * validate even if no prune-triggering write happened after it expired.
   */
  private getActivePending(pendingAuthId: string): PendingAuthUiState | undefined {
    const state = this.pending.get(pendingAuthId);
    if (!state) return undefined;
    if (Date.now() - state.createdAt > PENDING_UI_TTL_MS) {
      this.pending.delete(pendingAuthId);
      return undefined;
    }
    return state;
  }

  /**
   * Verify a submitted CSRF token against the minted one for this pending-auth.
   * Returns false on any mismatch / unknown / expired pending id (caller rejects 400).
   */
  verifyCsrf(pendingAuthId: string | undefined, submitted: string | undefined): boolean {
    if (!pendingAuthId || !submitted) return false;
    const state = this.getActivePending(pendingAuthId);
    if (!state) return false;
    return timingSafeEqualStr(state.csrf, submitted);
  }

  // ============================================
  // Accumulator (backs useAddedItems)
  // ============================================

  /**
   * Current accumulators for a pending-auth id (empty when none yet). Returns a
   * DEEP copy — each array is cloned — so callers (e.g. an extra handler reading
   * `ctx.current`) can never mutate the internal accumulator by reference.
   */
  getAddedItems(pendingAuthId: string | undefined): Record<string, unknown[]> {
    if (!pendingAuthId) return {};
    const state = this.pending.get(pendingAuthId);
    if (!state) return {};
    return Object.fromEntries(Object.entries(state.addedItems).map(([name, items]) => [name, [...items]]));
  }

  /** Append accepted items to an extra's accumulator and return the full map. */
  appendItems(pendingAuthId: string, extraName: string, items: unknown[]): Record<string, unknown[]> {
    const state = this.ensurePending(pendingAuthId);
    const current = state.addedItems[extraName] ?? [];
    state.addedItems[extraName] = [...current, ...items];
    return { ...state.addedItems };
  }

  private ensurePending(pendingAuthId: string): PendingAuthUiState {
    let state = this.pending.get(pendingAuthId);
    if (!state) {
      state = { csrf: sha256Hex(randomBytes(32)).slice(0, 43), addedItems: {}, createdAt: Date.now() };
      this.pending.set(pendingAuthId, state);
      // Prune here too (not only in mintCsrf) so entries first created via an
      // extra submit can't accumulate unbounded past their TTL.
      this.pruneExpired();
    }
    return state;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [id, state] of this.pending) {
      if (now - state.createdAt > PENDING_UI_TTL_MS) this.pending.delete(id);
    }
  }

  // ============================================
  // Extras routing
  // ============================================

  /** Whether a handler is registered for `name`. */
  hasExtra(name: string): boolean {
    return this.extras.has(name);
  }

  /**
   * Route an extra submission to its registered handler. Persists accepted items
   * into the per-pending-auth accumulator and returns the full result including
   * the updated `addedItems` map (so the client refreshes without a reload).
   * Returns `{ ok:false }` when no handler is registered for `name`.
   *
   * Note: the returned `addedItems` is the FULL accumulator MAP (keyed by extra
   * name) — the client `AuthExtraResult` shape — not the handler's per-call
   * `addedItems` (which is the list of NEW items).
   */
  async runExtra(
    name: string,
    pendingAuthId: string | undefined,
    input: Record<string, unknown>,
  ): Promise<AuthExtraRunResult> {
    const handler = this.extras.get(name);
    if (!handler) {
      return { ok: false, error: `Unknown extra "${name}".` };
    }
    const ctx: AuthExtraContext = {
      name,
      pendingAuthId,
      current: pendingAuthId ? (this.getAddedItems(pendingAuthId)[name] ?? []) : [],
    };
    let result: AuthExtraResult;
    try {
      result = await handler(input, ctx);
    } catch (err) {
      this.logger?.error(`auth.extras["${name}"] handler threw: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, error: 'Validation failed. Please try again.' };
    }
    if (!result || typeof result.ok !== 'boolean') {
      this.logger?.error(`auth.extras["${name}"] returned a malformed result.`);
      return { ok: false, error: 'Validation failed. Please try again.' };
    }
    if (result.ok && pendingAuthId && Array.isArray(result.addedItems) && result.addedItems.length > 0) {
      const addedItems = this.appendItems(pendingAuthId, name, result.addedItems);
      return { ok: true, sideEffects: result.sideEffects, addedItems };
    }
    return {
      ok: result.ok,
      error: result.error,
      sideEffects: result.sideEffects,
      ...(pendingAuthId ? { addedItems: this.getAddedItems(pendingAuthId) } : {}),
    };
  }

  // ============================================
  // Startup validation
  // ============================================

  /**
   * Validate every registered slot's source at startup (mirroring tool-ui's
   * `compileUIWidgets`): a missing / non-`.tsx` file is caught lazily at first
   * render and cached as an error so the slot falls back to the built-in page
   * instead of failing the request. This is just a cheap preflight log; it never
   * throws — a broken component must not take the server down.
   */
  async warmup(): Promise<void> {
    if (!this.hasAny()) return;
    for (const slot of this.slots.keys()) {
      if (this.getSlotSource(slot)) {
        this.logger?.verbose(`Validated auth.ui source for slot "${slot}"`);
      }
    }
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
