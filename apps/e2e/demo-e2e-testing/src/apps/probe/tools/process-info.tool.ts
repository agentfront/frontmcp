import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const outputSchema = z.object({
  pid: z.number(),
  marker: z.string().nullable(),
  authMode: z.string().nullable(),
});

@Tool({
  name: 'process-info',
  description: 'Returns the pid of the server process and the test environment it was started with',
  inputSchema: {},
  outputSchema,
})
export default class ProcessInfoTool extends ToolContext {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    return {
      pid: process.pid,
      marker: process.env['TEST_MARKER'] ?? null,
      authMode: process.env['FRONTMCP_TEST_AUTH_MODE'] ?? null,
    };
  }
}
