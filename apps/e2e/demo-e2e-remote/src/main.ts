import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { CachePlugin } from '@frontmcp/plugins';

const port = parseInt(process.env['PORT'] ?? '3112', 10);
const localMcpPort = parseInt(process.env['LOCAL_MCP_PORT'] ?? '3108', 10);

@FrontMcp({
  info: { name: 'Remote Gateway E2E', version: '0.1.0' },
  apps: [
    // Local test MCP server (must be first for initialization order)
    {
      name: 'local-test',
      urlType: 'url',
      url: `http://localhost:${localMcpPort}/`,
      namespace: 'local',
      transportOptions: {
        timeout: 30000,
        retryAttempts: 3,
      },
      standalone: false,
    },
    // Public Mintlify docs MCP server
    {
      name: 'mintlify-docs',
      urlType: 'url',
      url: 'https://mintlify.com/docs/mcp',
      namespace: 'mintlify',
      transportOptions: {
        timeout: 60000,
        retryAttempts: 2,
      },
      standalone: false,
    },
  ],
  plugins: [
    CachePlugin.init({
      type: 'memory',
      defaultTTL: 60,
      toolPatterns: ['mintlify:*', 'mintlify:SearchMintlify', 'SearchMintlify'],
    }),
  ],
  logging: { level: LogLevel.Verbose },
  http: { port },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
  auth: { mode: 'public' },
})
export default class RemoteGatewayServer {}
