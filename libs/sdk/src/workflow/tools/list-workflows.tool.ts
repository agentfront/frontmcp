import { z } from 'zod';
import { Tool, ToolContext } from '../../common';
import { WorkflowEntry } from '../../common/entries/workflow.entry';
import type { WorkflowRegistryInterface } from '../workflow.registry';

@Tool({
  name: 'list-workflows',
  description: 'List registered workflows with optional filtering by tags or labels.',
  inputSchema: {
    tags: z.array(z.string()).optional().describe('Filter by tags'),
    labels: z.record(z.string(), z.string()).optional().describe('Filter by labels'),
    query: z.string().optional().describe('Search query for name/description'),
  },
  outputSchema: {
    workflows: z.array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        trigger: z.string(),
        stepCount: z.number(),
        tags: z.array(z.string()).optional(),
      }),
    ),
    count: z.number(),
  },
  hideFromDiscovery: true,
})
export default class ListWorkflowsTool extends ToolContext {
  async execute(input: { tags?: string[]; labels?: Record<string, string>; query?: string }) {
    const scope = this.scope as unknown as { workflows?: WorkflowRegistryInterface };
    const workflowRegistry = scope.workflows;
    if (!workflowRegistry) {
      return { workflows: [], count: 0 };
    }

    const workflows = workflowRegistry.search(input.query, {
      tags: input.tags,
      labels: input.labels,
    });

    const mapped = workflows.map((w: WorkflowEntry) => ({
      name: w.name,
      description: w.metadata.description,
      trigger: w.getTrigger(),
      stepCount: w.getSteps().length,
      tags: w.getTags(),
    }));

    return {
      workflows: mapped,
      count: mapped.length,
    };
  }
}
