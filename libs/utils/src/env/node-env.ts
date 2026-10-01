/**
 * Node.js environment access.
 */

import { hasEdgeGlobalScope } from './edge-scope';

export function getEnv(key: string): string | undefined;
export function getEnv(key: string, defaultValue: string): string;
export function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}

export function getCwd(): string {
  return process.cwd();
}

/** A computed key: bundlers only replace the literal `process.env.NODE_ENV` member expression. */
const NODE_ENV_KEY = 'NODE_ENV';

/**
 * The NODE_ENV this process runs with.
 *
 * Bundlers replace `process.env.NODE_ENV` with a literal when they build —
 * `wrangler dev` with `"development"`, `wrangler deploy` with `"production"` —
 * so a value the deployment sets at run time (a Cloudflare Worker's
 * `[vars] NODE_ENV`) was never seen (#680). The live value is read first,
 * through a key no bundler folds; the build-time value only fills in when the
 * runtime sets none.
 */
export function getNodeEnv(): string | undefined {
  return process.env[NODE_ENV_KEY] || process.env['NODE_ENV'] || undefined;
}

export function isProduction(): boolean {
  return getNodeEnv() === 'production';
}

export function isDevelopment(): boolean {
  return getNodeEnv() === 'development';
}

export function getEnvFlag(key: string): boolean {
  const v = process.env[key];
  return v === '1' || v === 'true';
}

export function isDebug(): boolean {
  return getEnvFlag('DEBUG');
}

export function setEnv(key: string, value: string): void {
  process.env[key] = value;
}

export function isEdgeRuntime(): boolean {
  if (hasEdgeGlobalScope()) return true;
  return process.env['EDGE_RUNTIME'] !== undefined && process.env['VERCEL_ENV'] !== undefined;
}

export function isServerless(): boolean {
  return !!(
    process.env['VERCEL'] ||
    process.env['NETLIFY'] ||
    process.env['CF_PAGES'] ||
    process.env['AWS_LAMBDA_FUNCTION_NAME'] ||
    process.env['AZURE_FUNCTIONS_ENVIRONMENT'] ||
    process.env['K_SERVICE'] ||
    process.env['RAILWAY_ENVIRONMENT'] ||
    process.env['RENDER'] ||
    process.env['FLY_APP_NAME']
  );
}

export function supportsAnsi(): boolean {
  if (process.env['NO_COLOR']) return false;
  const forceColor = process.env['FORCE_COLOR'];
  if (forceColor !== undefined) {
    return forceColor !== '0' && forceColor.toLowerCase() !== 'false';
  }
  return process.stdout?.isTTY === true;
}
