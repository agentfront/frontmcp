import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { ProtoApp } from './apps/proto';

const port = parseInt(process.env['PORT'] ?? '3160', 10);

/**
 * E2E server for MCP protocol revision 2026-07-28.
 *
 * The same server must speak BOTH eras:
 * - 2026-07-28 — stateless, no `initialize`, per-request `_meta`.
 * - 2024-11-05 … 2025-11-25 — session + `initialize` handshake (unchanged).
 *
 * Version selection is per-request, so no configuration switch is involved.
 */
@FrontMcp({
  info: { name: 'Demo E2E Protocol 2026', version: '0.1.0' },
  apps: [ProtoApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public' },
  elicitation: { enabled: true },
  // `full` turns on every legacy transport (legacy SSE, streamable, stateful
  // and stateless JSON) so the backward-compatibility suite exercises the
  // widest possible surface alongside the new 2026-07-28 path.
  transport: { protocol: 'full' },
})
export default class Server {}
