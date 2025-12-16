import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { auditLog } from '../data/audit-log';

const outputSchema = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      timestamp: z.string(),
      toolName: z.string(),
      hookType: z.enum(['will', 'did']),
      stage: z.string(),
      priority: z.number(),
    }),
  ),
  stats: z.object({
    total: z.number(),
    willCount: z.number(),
    didCount: z.number(),
  }),
});

@Resource({
  uri: 'audit://log',
  name: 'Audit Log',
  description: 'Current audit log entries',
  mimeType: 'application/json',
})
export default class AuditLogResource extends ResourceContext<Record<string, never>, z.infer<typeof outputSchema>> {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    const entries = auditLog.getEntries();

    return {
      entries: entries.map((e) => ({
        id: e.id,
        timestamp: e.timestamp,
        toolName: e.toolName,
        hookType: e.hookType,
        stage: e.stage,
        priority: e.priority,
      })),
      stats: auditLog.getStats(),
    };
  }
}
