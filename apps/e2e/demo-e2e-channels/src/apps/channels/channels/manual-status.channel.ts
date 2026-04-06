import { channel } from '@frontmcp/sdk';

/**
 * Function-based channel for manual status broadcasts.
 * Uses the channel() builder instead of @Channel decorator.
 */
export const ManualStatusChannel = channel({
  name: 'status-updates',
  description: 'Manual server status notifications',
  source: { type: 'manual' },
})((payload) => {
  const data = payload as { message: string; level?: string };
  return {
    content: `Status: ${data.message}`,
    meta: { ...(data.level ? { level: data.level } : {}) },
  };
});
