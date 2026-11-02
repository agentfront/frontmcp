import type { JsonRpcFrame } from './stdio-framer';

/** `list_changed` notifications a reload may warrant, keyed by capability. */
const LIST_CHANGED = {
  tools: 'notifications/tools/list_changed',
  resources: 'notifications/resources/list_changed',
  prompts: 'notifications/prompts/list_changed',
} as const;

/** The `list_changed` notifications the capabilities of a fresh server advertise. */
export function listChangedNotifications(initializeResult: Record<string, unknown> | undefined): JsonRpcFrame[] {
  const capabilities = initializeResult?.['capabilities'];
  if (typeof capabilities !== 'object' || capabilities === null) return [];
  const frames: JsonRpcFrame[] = [];
  for (const [capability, method] of Object.entries(LIST_CHANGED)) {
    const entry = (capabilities as Record<string, unknown>)[capability];
    if (typeof entry === 'object' && entry !== null && (entry as { listChanged?: unknown }).listChanged === true) {
      frames.push({ jsonrpc: '2.0', method });
    }
  }
  return frames;
}
