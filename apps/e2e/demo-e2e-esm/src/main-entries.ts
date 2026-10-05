import { App, FrontMcp, LogLevel, Prompt, Resource, Tool } from '@frontmcp/sdk';

const port = parseInt(process.env['PORT'] ?? '3117', 10);
const esmServerUrl = `http://127.0.0.1:${parseInt(process.env['ESM_SERVER_PORT'] ?? '50400', 10)}`;

@App({
  name: 'entries',
  tools: [
    Tool.esm('@test/esm-tools@^1.0.0', 'echo'),
    Tool.esm('@test/esm-tools@^1.0.0', 'add', {
      metadata: { name: 'sum', description: 'Adds two numbers, loaded per entry' },
    }),
    Tool.esm('@test/esm-decorated@^1.0.0', 'echo', { metadata: { name: 'decorated_echo' } }),
    '@test/esm-multi@^1.0.0',
  ],
  resources: [Resource.esm('@test/esm-multi@^1.0.0', 'status')],
  prompts: [Prompt.esm('@test/esm-multi@^1.0.0', 'greeting-prompt')],
})
class EntriesApp {}

@FrontMcp({
  info: { name: 'Demo E2E ESM Entries', version: '0.1.0' },
  loader: { url: esmServerUrl },
  apps: [EntriesApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public' },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
})
export default class Server {}
