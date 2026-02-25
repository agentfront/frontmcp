import { tokenFactory } from './base.tokens';
import { RawMetadataShape } from '../types';
import { WorkflowMetadata } from '../metadata';

export const FrontMcpWorkflowTokens = {
  type: tokenFactory.type('workflow'),
  id: tokenFactory.meta('workflowId'),
  name: tokenFactory.meta('workflowName'),
  description: tokenFactory.meta('workflowDescription'),
  steps: tokenFactory.meta('workflowSteps'),
  trigger: tokenFactory.meta('workflowTrigger'),
  webhook: tokenFactory.meta('workflowWebhook'),
  timeout: tokenFactory.meta('workflowTimeout'),
  maxConcurrency: tokenFactory.meta('workflowMaxConcurrency'),
  tags: tokenFactory.meta('workflowTags'),
  labels: tokenFactory.meta('workflowLabels'),
  hideFromDiscovery: tokenFactory.meta('workflowHideFromDiscovery'),
  permissions: tokenFactory.meta('workflowPermissions'),
  inputSchema: tokenFactory.meta('workflowInputSchema'),
  outputSchema: tokenFactory.meta('workflowOutputSchema'),
  metadata: tokenFactory.meta('workflowMetadata'),
} as const satisfies RawMetadataShape<WorkflowMetadata, ExtendFrontMcpWorkflowMetadata>;

export const extendedWorkflowMetadata = tokenFactory.meta('extendedWorkflowMetadata');
