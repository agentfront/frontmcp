/**
 * CORS defaults from the environment.
 *
 * `frontmcp build` turns a deployment's `server.http.cors` block in
 * `frontmcp.config` into these variables (set only where the platform has not set
 * them). They apply when `@FrontMcp({ http: { cors } })` leaves CORS unset; an
 * explicit `cors` — including `false` — always wins.
 *
 * FRONTMCP_CORS_ORIGINS='["https://app.example.com"]'   (JSON array; '["*"]' allows any origin)
 * FRONTMCP_CORS_CREDENTIALS=true
 * FRONTMCP_CORS_MAX_AGE=600
 */

import { getEnv } from '@frontmcp/utils';

import type { CorsOptions } from '../../common/types/options/http/interfaces';

export function readCorsFromEnv(): CorsOptions | undefined {
  const rawOrigins = getEnv('FRONTMCP_CORS_ORIGINS');
  if (!rawOrigins) return undefined;

  let origins: unknown;
  try {
    origins = JSON.parse(rawOrigins);
  } catch {
    // A plain comma-separated list (hand-written env) is accepted too
    origins = rawOrigins.split(',');
  }
  const list = (Array.isArray(origins) ? origins : [origins])
    .filter((origin): origin is string => typeof origin === 'string')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (list.length === 0) return undefined;

  const cors: CorsOptions = { origin: list.includes('*') ? true : list };
  const credentials = getEnv('FRONTMCP_CORS_CREDENTIALS');
  if (credentials !== undefined) cors.credentials = credentials === 'true' || credentials === '1';
  const maxAge = Number(getEnv('FRONTMCP_CORS_MAX_AGE'));
  if (Number.isFinite(maxAge) && maxAge > 0) cors.maxAge = maxAge;
  return cors;
}

/** The CORS config in effect: the explicit `http.cors` when set (`false` included), else the env defaults. */
export function resolveHttpCors(cors: CorsOptions | false | undefined): CorsOptions | false | undefined {
  return cors !== undefined ? cors : readCorsFromEnv();
}
