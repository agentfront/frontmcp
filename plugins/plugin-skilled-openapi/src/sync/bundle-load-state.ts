// file: plugins/plugin-skilled-openapi/src/sync/bundle-load-state.ts

import { OverlayParseError } from '@frontmcp/adapters/skills';
import type { HealthProbeResult } from '@frontmcp/sdk';

/** Whether the plugin serves a bundle: one is loaded, loading failed with none loaded, or the first load hasn't finished. */
export type BundleLoadState =
  | { status: 'loading' }
  | { status: 'loaded'; bundleId: string; bundleVersion: string }
  | { status: 'failed'; reason: string };

/**
 * What the last bundle sync came to, and when: the bundle a pull or a push brought was applied, was the one already
 * served, or was refused; or a pull failed, and `cacheFallback` says the source served its cached bundle instead. The
 * reasons are as clients may read them ({@link publicLoadFailureReason}).
 */
export type BundleSyncOutcome =
  | { status: 'applied' | 'unchanged'; bundleId: string; bundleVersion: string; at: string }
  | { status: 'refused'; bundleId: string; bundleVersion: string; reason: string; at: string }
  | { status: 'failed'; reason: string; cacheFallback: boolean; at: string };

/** Whether a sync left the server serving the bundle its source or a push brought. */
function isUpToDate(outcome: BundleSyncOutcome): boolean {
  return outcome.status === 'applied' || outcome.status === 'unchanged';
}

const MAX_LISTED_ISSUES = 3;
const MAX_PUBLIC_REASON_LENGTH = 500;
const URL_PATTERN = /\b[a-z][a-z\d+.-]*:\/\/[^\s'"<>()]+/gi;
const JWT_PATTERN = /\beyJ[\w-]+\.[\w-]+\.[\w-]*/g;
const FILE_PATH_PATTERN = /(^|[\s'"(=,])(?:\/[^\s'"<>()]+|[a-z]:\\[^\s'"<>()]+)/gi;

/** Why a bundle failed to load, with the first issues the bundle's checks found. */
export function describeLoadError(error: unknown): string {
  if (error instanceof OverlayParseError && error.errors?.length) {
    return `${error.message}: ${error.errors.slice(0, MAX_LISTED_ISSUES).join('; ')}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** A load failure clients may read: its first line, with URLs cut to scheme, host and path, no tokens and no file paths. */
export function publicLoadFailureReason(reason: string): string {
  const [firstLine = ''] = reason.split('\n', 1);
  const redacted = firstLine
    .replace(JWT_PATTERN, '[token]')
    .replace(FILE_PATH_PATTERN, '$1[path]')
    .replace(URL_PATTERN, urlWithoutSecrets);
  return redacted.length > MAX_PUBLIC_REASON_LENGTH ? `${redacted.slice(0, MAX_PUBLIC_REASON_LENGTH)}...` : redacted;
}

function urlWithoutSecrets(text: string): string {
  try {
    const url = new URL(text);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '[url]';
  }
}

/**
 * The plugin's `/readyz` check: ready once a bundle is loaded, not ready while loading has failed. While the last sync
 * was refused or failed, the bundle served is stale: the check is `degraded`, which keeps the server ready, and names it.
 */
export function bundleHealth(state: BundleLoadState, lastSync?: BundleSyncOutcome): HealthProbeResult {
  switch (state.status) {
    case 'loaded': {
      const served = { bundleId: state.bundleId, bundleVersion: state.bundleVersion };
      if (!lastSync || isUpToDate(lastSync)) return { status: 'healthy', details: { state: 'loaded', ...served } };
      return { status: 'degraded', details: { state: 'stale', ...served, lastSync } };
    }
    case 'failed':
      return { status: 'unhealthy', details: { state: 'failed' }, error: `no skill bundle is loaded: ${state.reason}` };
    case 'loading':
      return { status: 'degraded', details: { state: 'loading' } };
  }
}
