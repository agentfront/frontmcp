import { z } from 'zod';
import { Tool, ToolContext } from '../../common';
import type { WorkflowRegistryInterface } from '../workflow.registry';

@Tool({
  name: 'remove-workflow',
  description: 'Remove a dynamic workflow by name.',
  inputSchema: {
    name: z.string().describe('Workflow name to remove'),
  },
  outputSchema: {
    success: z.boolean(),
    message: z.string(),
  },
  hideFromDiscovery: true,
})
export default class RemoveWorkflowTool extends ToolContext {
  async execute(input: { name: string }) {
    const scope = this.scope as unknown as { workflows?: WorkflowRegistryInterface };
    const workflowRegistry = scope.workflows;

    if (!workflowRegistry) {
      return this.fail(new Error('Workflows system is not enabled'));
    }

    const workflow = workflowRegistry.findByName(input.name);
    if (!workflow) {
      return this.fail(new Error(`Workflow "${input.name}" not found`));
    }

    if (!workflow.isDynamic()) {
      return this.fail(new Error(`Workflow "${input.name}" is not dynamic and cannot be removed`));
    }

    const removed = workflowRegistry.removeDynamic(input.name);
    return {
      success: removed,
      message: removed ? `Workflow "${input.name}" removed` : `Failed to remove workflow "${input.name}"`,
    };
  }
}
