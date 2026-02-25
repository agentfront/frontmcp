import { z } from 'zod';
import { Tool, ToolContext } from '../../common';
import { JobKind } from '../../common/records/job.record';
import type { ToolInputType, ToolOutputType } from '../../common/metadata/tool.metadata';
import type { JobRegistryInterface } from '../job.registry';

@Tool({
  name: 'register-job',
  description: 'Register a dynamic job that runs in a sandboxed environment.',
  inputSchema: {
    name: z.string().describe('Job name'),
    description: z.string().optional().describe('Job description'),
    script: z.string().describe('JavaScript source code for the job'),
    inputSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for input'),
    outputSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for output'),
    tags: z.array(z.string()).optional().describe('Tags for categorization'),
  },
  outputSchema: {
    success: z.boolean(),
    jobId: z.string(),
  },
  hideFromDiscovery: true,
})
export default class RegisterJobTool extends ToolContext {
  async execute(input: {
    name: string;
    description?: string;
    script: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    tags?: string[];
  }) {
    const scope = this.scope as unknown as { jobs?: JobRegistryInterface };
    const jobRegistry = scope.jobs;

    if (!jobRegistry) {
      return this.fail(new Error('Jobs system is not enabled'));
    }

    // Check if job already exists
    const existing = jobRegistry.findByName(input.name);
    if (existing) {
      return this.fail(new Error(`Job "${input.name}" already exists`));
    }

    const jobId = input.name;

    jobRegistry.registerDynamic({
      kind: JobKind.DYNAMIC,
      provide: jobId,
      metadata: {
        id: jobId,
        name: input.name,
        description: input.description,
        inputSchema: (input.inputSchema ?? {}) as unknown as ToolInputType,
        outputSchema: (input.outputSchema ?? {}) as unknown as ToolOutputType,
        tags: input.tags,
      },
      script: input.script,
      registeredBy: ((this.authInfo as Record<string, unknown>)?.['sub'] as string) ?? 'anonymous',
      registeredAt: Date.now(),
    });

    return { success: true, jobId };
  }
}
