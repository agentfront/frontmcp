import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';

const outputSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  serverName: z.string(),
  version: z.string(),
  uptime: z.number(),
  timestamp: z.string(),
});

type StatusOutput = z.infer<typeof outputSchema>;

// Track server start time
const serverStartTime = Date.now();

@Resource({
  uri: 'test://status',
  name: 'Server Status',
  description: 'Returns the current status of the local test MCP server',
  mimeType: 'application/json',
})
export default class StatusResource extends ResourceContext<Record<string, never>, StatusOutput> {
  async execute(): Promise<StatusOutput> {
    return {
      status: 'healthy',
      serverName: 'local-test-mcp',
      version: '0.1.0',
      uptime: Date.now() - serverStartTime,
      timestamp: new Date().toISOString(),
    };
  }
}
