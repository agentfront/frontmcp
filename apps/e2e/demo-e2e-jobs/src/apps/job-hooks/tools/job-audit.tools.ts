import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { jobAuditLog } from '../plugins/job-audit.plugin';

const entrySchema = z.object({
  job: z.string(),
  attempt: z.number(),
  outcome: z.enum(['ok', 'error']),
  runId: z.string().optional(),
  workflow: z.string().optional(),
  stepId: z.string().optional(),
});

@Tool({
  name: 'get-job-audit',
  description: 'The job attempts the job-audit plugin recorded',
  inputSchema: {},
  outputSchema: { entries: z.array(entrySchema) },
})
export class GetJobAuditTool extends ToolContext {
  async execute() {
    return { entries: [...jobAuditLog] };
  }
}

@Tool({
  name: 'clear-job-audit',
  description: 'Clears the job-audit log',
  inputSchema: {},
  outputSchema: { cleared: z.boolean() },
})
export class ClearJobAuditTool extends ToolContext {
  async execute() {
    jobAuditLog.length = 0;
    return { cleared: true };
  }
}
