/**
 * Dev Preload Script
 *
 * This script is injected into the child process via `tsx --import`
 * to enable the DevEventBus in the SDK.
 *
 * It sets the FRONTMCP_DEV_MODE environment variable which triggers
 * the SDK to activate its event bus and emit events to the parent process.
 */

// Enable dev mode in SDK
process.env['FRONTMCP_DEV_MODE'] = 'true';

// IMPORTANT: Force stderr transport by clearing process.send
// With shell: true in spawn, IPC doesn't work properly - events go nowhere
// By removing process.send, the SDK will fall back to stderr transport
const originalSend = process.send;
(process as any).send = undefined;

// Log that preload was activated (visible in dashboard logs)
console.log('[frontmcp] Dev dashboard mode activated');

// Write to stderr so it appears in the event pipe (for debugging)
process.stderr.write('[frontmcp-preload] FRONTMCP_DEV_MODE set to: ' + process.env['FRONTMCP_DEV_MODE'] + '\n');
process.stderr.write(
  '[frontmcp-preload] process.send was: ' + (originalSend ? 'defined' : 'undefined') + ' (now forced to undefined)\n',
);

// Handle uncaught errors gracefully
process.on('uncaughtException', (err) => {
  console.error('[frontmcp] Uncaught exception:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[frontmcp] Unhandled rejection:', reason);
});
