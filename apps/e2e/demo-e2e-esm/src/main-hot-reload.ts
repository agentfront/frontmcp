import { FrontMcp, App, LogLevel } from '@frontmcp/sdk';

const port = parseInt(process.env['PORT'] ?? '3116', 10);
const esmServerUrl = `http://127.0.0.1:${parseInt(process.env['ESM_SERVER_PORT'] ?? '50400', 10)}`;

@FrontMcp({
  info: { name: 'Demo E2E ESM Hot-Reload', version: '0.1.0' },
  loader: { url: esmServerUrl },
  apps: [
    App.esm('@test/esm-tools@^1.0.0', {
      namespace: 'esm',
      autoUpdate: { enabled: true, intervalMs: 2000 },
      cacheTTL: 1000,
    }),
  ],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public' },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
})
export default class Server {}
