import { z } from '@frontmcp/lazy-zod';

import { Tool, ToolContext } from '../../common';
import { JobNotAuthorizedError } from '../../errors';
import type { JobExecutionManager } from '../../job/execution/job-execution.manager';
import type { JobRegistryInterface } from '../../job/job.registry';
import type { WorkflowRegistryInterface } from '../workflow.registry';

@Tool({
  name: 'execute_workflow',
  description: 'Execute a registered workflow by name. Supports inline and background execution.',
  inputSchema: {
    name: z.string().describe('Workflow name to execute'),
    input: z.record(z.string(), z.unknown()).optional().describe('Workflow input data'),
    background: z.boolean().optional().default(false).describe('Run in background (returns runId)'),
  },
  outputSchema: {
    runId: z.string(),
    state: z.string(),
    result: z.unknown().optional(),
  },
})
export default class ExecuteWorkflowTool extends ToolContext {
  async execute(input: { name: string; input?: Record<string, unknown>; background: boolean }) {
    const scope = this.scope as unknown as {
      jobs?: JobRegistryInterface;
      workflows?: WorkflowRegistryInterface;
      _jobExecutionManager?: JobExecutionManager;
    };
    const executionManager = scope._jobExecutionManager;
    const workflowRegistry = scope.workflows;
    const jobRegistry = scope.jobs;

    if (!executionManager || !workflowRegistry || !jobRegistry) {
      return this.fail(new Error('Jobs/workflows system is not enabled'));
    }

    const workflow = workflowRegistry.findByName(input.name);
    if (!workflow) {
      return this.fail(new JobNotAuthorizedError(input.name));
    }

    const result = await executionManager.executeWorkflow(workflow, jobRegistry, {
      background: input.background,
      sessionId: this.authInfo.sessionId,
      authInfo: this.authInfo,
      authoritiesContextBuilder: this.scope.authoritiesContextBuilder,
      workflowInput: input.input,
    });

    return result;
  }
}
