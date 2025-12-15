import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { auditLog, AuditEntry } from '../data/audit-log';

const inputSchema = {
  toolName: z.string().optional().describe('Filter by tool name'),
};

const outputSchema = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      timestamp: z.string(),
      toolName: z.string(),
      hookType: z.enum(['will', 'did']),
      stage: z.string(),
      priority: z.number(),
      durationMs: z.number().optional(),
      success: z.boolean().optional(),
    }),
  ),
  executionOrder: z.array(z.string()),
  stats: z.object({
    total: z.number(),
    willCount: z.number(),
    didCount: z.number(),
  }),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'get-audit-log',
  description: 'Retrieve the audit log entries',
  inputSchema,
  outputSchema,
})
export default class GetAuditLogTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const entries = input.toolName ? auditLog.getEntriesForTool(input.toolName) : auditLog.getEntries();

    return {
      entries: entries.map((e) => ({
        id: e.id,
        timestamp: e.timestamp,
        toolName: e.toolName,
        hookType: e.hookType,
        stage: e.stage,
        priority: e.priority,
        durationMs: e.durationMs,
        success: e.success,
      })),
      executionOrder: auditLog.getExecutionOrder(),
      stats: auditLog.getStats(),
    };
  }
}
