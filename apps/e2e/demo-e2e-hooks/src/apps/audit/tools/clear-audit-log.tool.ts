import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { auditLog } from '../data/audit-log';

const inputSchema = {};

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

type Input = z.input<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'clear-audit-log',
  description: 'Clear all audit log entries',
  inputSchema,
  outputSchema,
})
export default class ClearAuditLogTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(_input: Input): Promise<Output> {
    auditLog.clear();

    return {
      success: true,
      message: 'Audit log cleared',
    };
  }
}
