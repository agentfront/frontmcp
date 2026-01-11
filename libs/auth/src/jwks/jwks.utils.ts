export function trimSlash(s: string) {
  return (s ?? '').replace(/\/+$/, '');
}
export function normalizeIssuer(u?: string) {
  return trimSlash(String(u ?? ''));
}

/** Safe, no-verify JWT payload decode (returns undefined on error). */
export function decodeJwtPayloadSafe(token?: string): Record<string, unknown> | undefined {
  if (!token) return undefined;
  const parts = token.split('.');
  if (parts.length < 2) return undefined;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json =
      typeof Buffer !== 'undefined'
        ? Buffer.from(b64, 'base64').toString('utf8')
        : // browser fallback
          atob(b64);
    const obj = JSON.parse(json);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
