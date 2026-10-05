import { App, FrontMcp, LogLevel, Prompt, Resource, Tool } from '@frontmcp/sdk';

const port = parseInt(process.env['PORT'] ?? '3114', 10);
const localMcpPort = parseInt(process.env['LOCAL_MCP_PORT'] ?? '3108', 10);
const localUrl = `http://localhost:${localMcpPort}/`;

/** Proxies two tools, a resource and a prompt of the local server over one connection. */
@App({
  name: 'entries',
  tools: [
    Tool.remote(localUrl, 'echo'),
    Tool.remote(localUrl, 'add', { metadata: { name: 'sum', description: 'Adds two numbers on the local server' } }),
  ],
  resources: [Resource.remote(localUrl, 'Server Status')],
  prompts: [Prompt.remote(localUrl, 'greeting')],
})
class EntriesApp {}

@FrontMcp({
  info: { name: 'Remote Entries E2E', version: '0.1.0' },
  apps: [EntriesApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  transport: { protocol: { json: true, legacy: true, strictSession: false } },
  auth: { mode: 'public' },
})
export default class RemoteEntriesServer {}
