/**
 * A public loopback server for the Origin check. `ALLOWED_ORIGINS` (comma-separated) sets an explicit
 * `dnsRebindingProtection.allowedOrigins`; without it the allowed Origins are derived from the listener.
 */
import { App, FrontMcp, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

@App({ id: 'origin', name: 'Origin', tools: [PingTool] })
class OriginApp {}

const port = Number.parseInt(process.env['PORT'] ?? '3151', 10);
const allowedOrigins = (process.env['ALLOWED_ORIGINS'] ?? '').split(',').filter(Boolean);

@FrontMcp({
  info: { name: 'Demo E2E Loopback Origin', version: '0.1.0' },
  apps: [OriginApp],
  logging: { level: LogLevel.Warn },
  http: allowedOrigins.length ? { port, security: { dnsRebindingProtection: { allowedOrigins } } } : { port },
  auth: { mode: 'public' },
})
export default class Server {}
