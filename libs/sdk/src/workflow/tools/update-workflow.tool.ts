import { internalZ as z } from '@frontmcp/lazy-zod';

import { Tool, ToolContext } from '../../common';
import { type WorkflowDynamicRecord } from '../../common/records/workflow.record';
import { DynamicJobRegistrationDisabledError, InvalidInputError, JobNotAuthorizedError } from '../../errors';
import { JobPermissionGuard } from '../../job/job-permission.guard';
import { MAX_RUNTIME_WORKFLOW_STEPS } from './runtime-workflow.limits';

@Tool({
  name: 'update_workflow',
  description:
    'Update a workflow registered at runtime: its steps, description or tags. The fields given replace its own.',
  inputSchema: {
    name: z.string().describe('Workflow name to update'),
    description: z.string().optional().describe('New description'),
    steps: z
      .array(
        z.object({
          id: z.string().describe('Step identifier'),
          jobName: z.string().describe('Job name to execute'),
          input: z.record(z.string(), z.unknown()).optional().describe('Static input for the step'),
          dependsOn: z
            .array(z.string())
            .max(MAX_RUNTIME_WORKFLOW_STEPS)
            .optional()
            .describe('Step IDs that must complete first'),
          continueOnError: z.boolean().optional().describe('Continue on failure'),
          timeout: z.number().optional().describe('Step timeout in ms'),
        }),
      )
      .max(MAX_RUNTIME_WORKFLOW_STEPS)
      .min(1)
      .optional()
      .describe('New step definitions'),
    tags: z.array(z.string()).optional().describe('New tags'),
  },
  outputSchema: {
    success: z.boolean(),
    workflowId: z.string(),
  },
  hideFromDiscovery: true,
})
export default class UpdateWorkflowTool extends ToolContext {
  async execute(input: {
    name: string;
    description?: string;
    steps?: Array<{
      id: string;
      jobName: string;
      input?: Record<string, unknown>;
      dependsOn?: string[];
      continueOnError?: boolean;
      timeout?: number;
    }>;
    tags?: string[];
  }) {
    const workflowRegistry = this.scope.workflows;
    if (!workflowRegistry) {
      return this.fail(new Error('Workflows system is not enabled'));
    }

    // Defense in depth, as register_workflow: the tool is registered only with `jobs.allowDynamicRegistration`
    if (!this.dynamicRegistrationEnabled()) {
      return this.fail(new DynamicJobRegistrationDisabledError('workflow'));
    }

    // A workflow the caller may not update reads like an unknown one, as remove_workflow's denial does
    const workflow = workflowRegistry.findByName(input.name);
    const builder = this.scope.authoritiesContextBuilder;
    if (
      !workflow ||
      !(await JobPermissionGuard.check(workflow.metadata.permissions, 'update', this.authInfo, builder))
    ) {
      return this.fail(new JobNotAuthorizedError(input.name));
    }
    if (!workflow.isDynamic()) {
      if (!(await JobPermissionGuard.maySee(workflow.metadata.permissions, this.authInfo, builder))) {
        return this.fail(new JobNotAuthorizedError(input.name));
      }
      return this.fail(new InvalidInputError(`Workflow "${input.name}" is declared in code and cannot be updated`));
    }

    const record = workflow.record as WorkflowDynamicRecord;
    const { description, steps, tags } = input;
    workflowRegistry.registerDynamic({
      ...record,
      metadata: {
        ...record.metadata,
        ...(description === undefined ? {} : { description }),
        ...(steps === undefined ? {} : { steps }),
        ...(tags === undefined ? {} : { tags }),
      },
    });

    return { success: true, workflowId: record.provide };
  }

  private dynamicRegistrationEnabled(): boolean {
    const jobs = (this.scope.metadata as { jobs?: { allowDynamicRegistration?: boolean } } | undefined)?.jobs;
    return jobs?.allowDynamicRegistration === true;
  }
}
