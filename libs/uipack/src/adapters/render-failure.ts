/**
 * Render Failure Type Guard
 *
 * @packageDocumentation
 */

/**
 * Shape of a UI render failure result.
 */
export interface UIRenderFailure {
  reason: string;
}

/**
 * Type guard for UI render failure objects.
 *
 * A render failure is an object with a `reason` string and no `meta` property.
 */
export function isUIRenderFailure(result: unknown): result is UIRenderFailure {
  if (typeof result !== 'object' || result === null) {
    return false;
  }
  const rec = result as Record<string, unknown>;
  return typeof rec['reason'] === 'string' && !('meta' in rec);
}
