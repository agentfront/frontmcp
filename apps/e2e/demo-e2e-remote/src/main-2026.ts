import { App, FrontMcp, LogLevel } from '@frontmcp/sdk';

const port = parseInt(process.env['PORT'] ?? '3113', 10);
const localMcpPort = parseInt(process.env['LOCAL_MCP_PORT'] ?? '3108', 10);
const localUrl = `http://localhost:${localMcpPort}/`;

/**
 * Gateway proxying the same local server twice: once over the session
 * transports (`initialize`) and once over the stateless 2026-07-28 revision.
 * A short `cacheTTL` makes every listing re-discover the remotes.
 */
@FrontMcp({
  info: { name: 'Remote Gateway 2026 E2E', version: '0.1.0' },
  apps: [
    App.remote(localUrl, { name: 'legacy-remote', namespace: 'legacy', cacheTTL: 200 }),
    App.remote(localUrl, {
      name: 'stateless-remote',
      namespace: 'modern',
      cacheTTL: 200,
      transportOptions: { protocolVersion: '2026-07-28' },
    }),
  ],
  logging: { level: LogLevel.Warn },
  http: { port },
  transport: { protocol: { json: true, legacy: true, strictSession: false } },
  auth: { mode: 'public' },
})
export default class RemoteGateway2026Server {}
