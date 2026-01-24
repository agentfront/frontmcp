import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { CachePlugin } from '@frontmcp/plugins';

const port = parseInt(process.env['PORT'] ?? '3112', 10);
const localMcpPort = parseInt(process.env['LOCAL_MCP_PORT'] ?? '3108', 10);
const mockMintlifyPort = parseInt(process.env['MOCK_MINTLIFY_PORT'] ?? '3097', 10);

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
    // Mock Mintlify MCP server (local mock for E2E testing)
    {
      name: 'mintlify-docs',
      urlType: 'url',
      url: `http://localhost:${mockMintlifyPort}/`,
      namespace: 'mintlify',
      transportOptions: {
        timeout: 30000,
        retryAttempts: 3,
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
  logging: { level: LogLevel.Warn },
  http: { port },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
  auth: { mode: 'public' },
})
export default class RemoteGatewayServer {}
