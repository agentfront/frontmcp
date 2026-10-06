import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { WidgetsApp } from './apps/widgets';

const port = parseInt(process.env['PORT'] ?? '3107', 10);
const extApps =
  process.env['EXT_APPS_MODE'] === 'disabled'
    ? { enabled: false }
    : process.env['EXT_APPS_MODE'] === 'all-capabilities'
      ? { hostCapabilities: { openLink: true, modelContextUpdate: true, widgetTools: true } }
      : undefined;

@FrontMcp({
  info: { name: 'Demo E2E UI', version: '0.1.0' },
  apps: [WidgetsApp],
  // The fixture templates return plain markup strings and escape values themselves (1.9 escapes strings by default)
  ui: { escapeStringResults: false },
  logging: { level: LogLevel.Warn },
  http: { port },
  extApps,
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
})
export default class Server {}
