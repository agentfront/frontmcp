/**
 * Pure helper: resolve the `EntryOwnerRef` a remote-app instance should use
 * when stamping owner lineage onto registered tools/resources/prompts.
 *
 * When `ownerAppName` is set, look up that local app in the scope's
 * `AppRegistry` and return an owner ref keyed on it. Callers (the remote-
 * app instance, the tests) pass in their own `fallback` owner — typically
 * the self-owner where `owner.id === remote appId` — which is returned
 * whenever (a) no `ownerAppName` is configured, (b) the scope has no
 * usable `AppRegistry`, or (c) the name doesn't match any contributed app.
 *
 * A warning is logged on fallback-after-miss (case c) and on missing-
 * registry (case b) because those are configuration errors worth
 * surfacing; case (a) is the no-opt-in happy path and stays quiet.
 *
 * Extracted to its own module so the resolution logic can be unit-tested
 * without constructing a full `AppRemoteInstance`.
 */

import type { EntryOwnerRef } from '../../common';

/** Subset of a logger we actually use here. */
export interface ResolveOwnerLogger {
  warn?(msg: string, meta?: Record<string, unknown>): void;
}

/** Subset of an `AppEntry` the resolver reads. */
export interface ResolveAppEntryLike {
  readonly metadata?: { readonly name?: string };
}

/**
 * Subset of `AppRegistry` the resolver needs. Narrowed to allow passing
 * test fakes without constructing a full registry.
 */
export interface ResolveAppsLike {
  getApps(): readonly ResolveAppEntryLike[];
}

export interface ResolveRemoteAppOwnerInput {
  ownerAppName: string | undefined;
  fallback: EntryOwnerRef;
  apps: ResolveAppsLike | undefined;
  logger?: ResolveOwnerLogger;
  /** Remote app id, used only in warning messages for diagnosability. */
  remoteId: string;
}

export function resolveRemoteAppOwner(input: ResolveRemoteAppOwnerInput): EntryOwnerRef {
  const { ownerAppName, fallback, apps, logger, remoteId } = input;
  if (!ownerAppName) return fallback;

  if (!apps || typeof apps.getApps !== 'function') {
    logger?.warn?.(`Remote app ${remoteId}: cannot resolve ownerAppName='${ownerAppName}' — scope has no AppRegistry`);
    return fallback;
  }

  const target = apps.getApps().find((app) => app.metadata?.name === ownerAppName);
  if (!target) {
    logger?.warn?.(
      `Remote app ${remoteId}: ownerAppName='${ownerAppName}' did not resolve in AppRegistry — falling back to remote-id ownership`,
    );
    return fallback;
  }

  // `AppEntry.token` is `protected readonly` at the base-class level — read
  // it via a structural cast rather than exposing a public getter on every
  // app variant. The token is what the registry uses to bind the app;
  // ownership lineage only needs it as a ref.
  const token = (target as unknown as { token: EntryOwnerRef['ref'] }).token;
  if (!token) {
    logger?.warn?.(
      `Remote app ${remoteId}: ownerAppName='${ownerAppName}' resolved but target app has no token — falling back`,
    );
    return fallback;
  }
  return { kind: 'app', id: ownerAppName, ref: token };
}
