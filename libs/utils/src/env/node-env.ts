/**
 * Node.js environment access.
 */

export function getEnv(key: string): string | undefined;
export function getEnv(key: string, defaultValue: string): string;
export function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}

export function getCwd(): string {
  return process.cwd();
}

export function isProduction(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

export function isDevelopment(): boolean {
  return process.env['NODE_ENV'] === 'development';
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
  if (typeof globalThis !== 'undefined' && 'EdgeRuntime' in globalThis) return true;
  if (typeof globalThis !== 'undefined' && 'caches' in globalThis && !('window' in globalThis)) return true;
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
  if (process.env['FORCE_COLOR']) return true;
  return !!(process.stdout && (process.stdout as any).isTTY);
}
