import { FrontMcp, LogLevel, loadFrom } from '@frontmcp/sdk';

const port = parseInt(process.env['PORT'] ?? '3115', 10);
const esmServerUrl = `http://127.0.0.1:${parseInt(process.env['ESM_SERVER_PORT'] ?? '50400', 10)}`;

@FrontMcp({
  info: { name: 'Demo E2E ESM', version: '0.1.0' },
  loader: { url: esmServerUrl },
  apps: [
    loadFrom('@test/esm-tools@^1.0.0', { namespace: 'esm', cacheTTL: 60000 }),
    loadFrom('@test/esm-multi@^1.0.0', { namespace: 'multi' }),
  ],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public' },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
})
export default class Server {}
