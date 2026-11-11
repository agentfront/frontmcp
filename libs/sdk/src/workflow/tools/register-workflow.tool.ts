import { internalZ as z } from '@frontmcp/lazy-zod';

import { Tool, ToolContext } from '../../common';
import { type WorkflowTriggerType } from '../../common/metadata/workflow.metadata';
import { WorkflowKind } from '../../common/records/workflow.record';
import { DynamicJobRegistrationDisabledError, InvalidInputError } from '../../errors';

@Tool({
  name: 'register_workflow',
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
    trigger: z
      .enum(['manual', 'webhook', 'event', 'schedule'])
      .optional()
      .describe(
        "Trigger type; 'webhook', 'event' and 'schedule' are refused: a workflow registered at runtime runs " +
          'through execute_workflow, and a triggered workflow is declared with @Workflow',
      ),
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
    trigger?: WorkflowTriggerType;
    tags?: string[];
  }) {
    const workflowRegistry = this.scope.workflows;

    if (!workflowRegistry) {
      return this.fail(new Error('Workflows system is not enabled'));
    }

    // Defense in depth: the tool is normally not registered at all unless
    // `jobs.allowDynamicRegistration` is true, but a host that wires it up by
    // hand must not get an ungated arbitrary-script entry point
    // (GHSA-58v2-gpcc-jmqv).
    if (!this.dynamicRegistrationEnabled()) {
      return this.fail(new DynamicJobRegistrationDisabledError('workflow'));
    }

    // A webhook's route, an event's listener and a schedule's cron are set up for the workflows declared in code
    if (input.trigger !== undefined && input.trigger !== 'manual') {
      return this.fail(
        new InvalidInputError(
          `A workflow registered at runtime can't have trigger: '${input.trigger}': declare it with @Workflow`,
        ),
      );
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

  private dynamicRegistrationEnabled(): boolean {
    const jobs = (this.scope.metadata as { jobs?: { allowDynamicRegistration?: boolean } } | undefined)?.jobs;
    return jobs?.allowDynamicRegistration === true;
  }
}
