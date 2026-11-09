/**
 * The checks `ApprovalPlugin.init()` runs on its webhook and recheck options, and the settings they resolve to.
 *
 * @module @frontmcp/plugin-approval
 */

import { isProduction } from '@frontmcp/utils';

import { ApprovalConfigurationError } from './approval';
import type { ApprovalPluginOptions, RecheckHeaders } from './approval.plugin';
import { signingKeyOf } from './external/webhook-signature';

/** Where `mode: 'webhook'` takes decisions when `webhook.callbackPath` is not set. */
export const DEFAULT_CALLBACK_PATH = '/approval/callback';

/** How long a request waits between two polls of `recheck.url` when `recheck.interval` is not set. */
export const DEFAULT_RECHECK_INTERVAL_MS = 2_000;

/** How many times a request polls `recheck.url` when `recheck.maxAttempts` is not set. */
export const DEFAULT_RECHECK_MAX_ATTEMPTS = 5;

/** The longest a call may wait for `recheck.url`'s decision: `interval × (maxAttempts − 1)`. */
const MAX_RECHECK_WAIT_MS = 120_000;

/** The shortest HMAC key a signing secret may give. */
const MIN_SECRET_BYTES = 24;

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const CALLBACK_PATH_PATTERN = /^(\/[A-Za-z0-9._~-]+)+$/;

export interface ResolvedWebhook {
  url: string;
  signingKey: Uint8Array;
  includeJwt: boolean;
  callbackPath: string;
  challengeTtlSeconds: number;
}

export type RecheckAuth = 'jwt' | 'bearer' | 'none' | 'custom';

export interface ResolvedRecheck {
  url: string;
  auth: RecheckAuth;
  token?: string;
  headers?: RecheckHeaders;
  signingKey?: Uint8Array;
  intervalMs: number;
  maxAttempts: number;
}

/** The external approval system the options configure: a webhook, a recheck endpoint, or neither. */
export interface ResolvedExternalApproval {
  webhook?: ResolvedWebhook;
  recheck?: ResolvedRecheck;
}

function refuse(message: string): never {
  throw new ApprovalConfigurationError(`ApprovalPlugin ${message}`);
}

/** The names of the options in `values` that are set. */
function setOptions(values: Record<string, unknown>): string[] {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name);
}

/**
 * Checks an outbound URL: HTTPS, or `http://` to a loopback host outside production, with no credentials in it. The
 * error names the option and the URL's scheme and host only, never its path or query.
 */
function checkOutboundUrl(option: string, url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return refuse(`\`${option}\` is not a URL`);
  }
  if (parsed.username || parsed.password) {
    refuse(`\`${option}\` must not carry credentials; use the auth options instead`);
  }
  const loopbackInDevelopment =
    parsed.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(parsed.hostname) && !isProduction();
  if (parsed.protocol !== 'https:' && !loopbackInDevelopment) {
    refuse(
      `\`${option}\` must be an https:// URL (http://localhost is accepted when NODE_ENV is not production), ` +
        `got ${parsed.protocol}//${parsed.host}`,
    );
  }
  return parsed.toString();
}

function checkSecret(option: string, secret: string | undefined): Uint8Array {
  if (secret === undefined || secret.trim() === '') {
    return refuse(`needs \`${option}\` to sign its requests and verify callbacks`);
  }
  let signingKey: Uint8Array;
  try {
    signingKey = signingKeyOf(secret);
  } catch {
    return refuse(`\`${option}\` starts with whsec_ but the rest is not base64`);
  }
  if (signingKey.length < MIN_SECRET_BYTES) {
    refuse(`\`${option}\` must be at least ${MIN_SECRET_BYTES} bytes (32 characters or more is recommended)`);
  }
  return signingKey;
}

function checkWholeNumber(option: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    refuse(`\`${option}\` must be a whole number from ${min} to ${max}, got ${value}`);
  }
  return value;
}

function resolveWebhook(options: ApprovalPluginOptions): ResolvedWebhook | undefined {
  const { url, secret, includeJwt, callbackPath, challengeTtl } = options.webhook ?? {};
  const external = setOptions({ url, secret, includeJwt, callbackPath }).map((name) => `\`webhook.${name}\``);
  if (external.length === 0) return undefined;
  if (options.mode !== 'webhook') refuse(`${external.join(', ')} need \`mode: 'webhook'\``);
  if (url === undefined) refuse(`${external.join(', ')} need \`webhook.url\``);

  const path = callbackPath ?? DEFAULT_CALLBACK_PATH;
  if (!CALLBACK_PATH_PATTERN.test(path) || path.length > 256) {
    refuse(`\`webhook.callbackPath\` must be a path such as ${DEFAULT_CALLBACK_PATH}, got ${JSON.stringify(path)}`);
  }
  return {
    url: checkOutboundUrl('webhook.url', url),
    signingKey: checkSecret('webhook.secret', secret),
    includeJwt: includeJwt === true,
    callbackPath: path,
    challengeTtlSeconds: challengeTtl ?? 300,
  };
}

function resolveRecheck(options: ApprovalPluginOptions): ResolvedRecheck | undefined {
  if (options.recheck === undefined) return undefined;
  const { url, auth = 'none', token, headers, secret, interval, maxAttempts } = options.recheck;
  if (options.mode === 'webhook') refuse("`recheck` needs `mode: 'recheck'`");
  if (url === undefined) {
    const others = setOptions({ auth: options.recheck.auth, token, headers, secret, interval, maxAttempts });
    refuse(`${others.map((name) => `\`recheck.${name}\``).join(', ') || '`recheck`'} need \`recheck.url\``);
  }
  if (!['jwt', 'bearer', 'none', 'custom'].includes(auth)) {
    refuse(`\`recheck.auth\` must be 'jwt', 'bearer', 'none' or 'custom', got ${JSON.stringify(auth)}`);
  }
  if (auth === 'bearer' && !token) refuse("`recheck.auth: 'bearer'` needs `recheck.token`");
  if (auth !== 'bearer' && token !== undefined) refuse("`recheck.token` is only sent with `recheck.auth: 'bearer'`");
  if (auth === 'custom' && typeof headers !== 'function')
    refuse("`recheck.auth: 'custom'` needs a `recheck.headers` function");
  if (auth !== 'custom' && headers !== undefined)
    refuse("`recheck.headers` is only used with `recheck.auth: 'custom'`");

  const intervalMs = checkWholeNumber('recheck.interval', interval ?? DEFAULT_RECHECK_INTERVAL_MS, 100, 60_000);
  const attempts = checkWholeNumber('recheck.maxAttempts', maxAttempts ?? DEFAULT_RECHECK_MAX_ATTEMPTS, 1, 60);
  if (intervalMs * (attempts - 1) > MAX_RECHECK_WAIT_MS) {
    refuse(
      `would keep a call waiting ${intervalMs * (attempts - 1)} ms: \`recheck.interval\` × (\`recheck.maxAttempts\` − 1) ` +
        `must be ${MAX_RECHECK_WAIT_MS} ms or less`,
    );
  }
  return {
    url: checkOutboundUrl('recheck.url', url),
    auth,
    token,
    headers,
    signingKey: secret === undefined ? undefined : checkSecret('recheck.secret', secret),
    intervalMs,
    maxAttempts: attempts,
  };
}

/**
 * The webhook and recheck settings `options` configure, checked. Throws `ApprovalConfigurationError`, so the server
 * doesn't start, for a combination that cannot work: a webhook without a secret, an `http://` URL in production,
 * `webhook.*` outside `mode: 'webhook'`, `recheck.auth: 'bearer'` without a token, and so on.
 */
export function resolveExternalApproval(options: ApprovalPluginOptions): ResolvedExternalApproval {
  return { webhook: resolveWebhook(options), recheck: resolveRecheck(options) };
}
