import { z } from 'zod';
import { Tool, ToolContext } from '../../common';
import { WorkflowKind } from '../../common/records/workflow.record';
import type { WorkflowRegistryInterface } from '../workflow.registry';

@Tool({
  name: 'register-workflow',
  description: 'Register a dynamic workflow with step definitions.',
  inputSchema: {
    name: z.string().describe('Workflow name'),
    description: z.string().optional().describe('Workflow description'),
    steps: z
      .array(
        z.object({
          id: z.string().describe('Step identifier'),
          jobName: z.string().describe('Job name to execute'),
          input: z.record(z.string(), z.unknown()).optional().describe('Static input for the step'),
          dependsOn: z.array(z.string()).optional().describe('Step IDs that must complete first'),
          continueOnError: z.boolean().optional().describe('Continue on failure'),
          timeout: z.number().optional().describe('Step timeout in ms'),
        }),
      )
      .describe('Workflow step definitions'),
    trigger: z.enum(['manual', 'webhook', 'event']).optional().describe('Trigger type'),
    tags: z.array(z.string()).optional().describe('Tags for categorization'),
  },
  outputSchema: {
    success: z.boolean(),
    workflowId: z.string(),
  },
  hideFromDiscovery: true,
})
export default class RegisterWorkflowTool extends ToolContext {
  async execute(input: {
    name: string;
    description?: string;
    steps: Array<{
      id: string;
      jobName: string;
      input?: Record<string, unknown>;
      dependsOn?: string[];
      continueOnError?: boolean;
      timeout?: number;
    }>;
    trigger?: 'manual' | 'webhook' | 'event';
    tags?: string[];
  }) {
    const scope = this.scope as unknown as { workflows?: WorkflowRegistryInterface };
    const workflowRegistry = scope.workflows;

    if (!workflowRegistry) {
      return this.fail(new Error('Workflows system is not enabled'));
    }

    const existing = workflowRegistry.findByName(input.name);
    if (existing) {
      return this.fail(new Error(`Workflow "${input.name}" already exists`));
    }

    const workflowId = input.name;

    workflowRegistry.registerDynamic({
      kind: WorkflowKind.DYNAMIC,
      provide: workflowId,
      metadata: {
        id: workflowId,
        name: input.name,
        description: input.description,
        steps: input.steps,
        trigger: input.trigger ?? 'manual',
        tags: input.tags,
      },
      registeredBy: ((this.authInfo as Record<string, unknown>)?.['sub'] as string) ?? 'anonymous',
      registeredAt: Date.now(),
    });

    return { success: true, workflowId };
  }
}
