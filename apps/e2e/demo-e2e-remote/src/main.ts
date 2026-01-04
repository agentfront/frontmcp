import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { CachePlugin } from '@frontmcp/plugins';

const port = parseInt(process.env['PORT'] ?? '3098', 10);
const localMcpPort = parseInt(process.env['LOCAL_MCP_PORT'] ?? '3099', 10);

@FrontMcp({
  info: { name: 'Remote Gateway E2E', version: '0.1.0' },
  apps: [
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
    // Local test MCP server
    {
      name: 'local-test',
      urlType: 'url',
      url: `http://localhost:${localMcpPort}/mcp`,
      namespace: 'local',
      transportOptions: {
        timeout: 30000,
        retryAttempts: 1,
      },
      standalone: false,
    },
  ],
  plugins: [
    CachePlugin.init({
      type: 'memory',
      defaultTTL: 60,
    }),
  ],
  logging: { level: LogLevel.VERBOSE },
  http: { port },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
    transport: {
      enableStatefulHttp: true,
      enableStreamableHttp: true,
      enableStatelessHttp: false,
      requireSessionForStreamable: false,
      enableLegacySSE: true,
      enableSseListener: true,
    },
  },
})
export default class RemoteGatewayServer {}
