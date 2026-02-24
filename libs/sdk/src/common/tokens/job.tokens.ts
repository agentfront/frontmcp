import { tokenFactory } from './base.tokens';
import { RawMetadataShape } from '../types';
import { JobMetadata } from '../metadata';

export const FrontMcpJobTokens = {
  type: tokenFactory.type('job'),
  id: tokenFactory.meta('jobId'),
  name: tokenFactory.meta('jobName'),
  description: tokenFactory.meta('jobDescription'),
  inputSchema: tokenFactory.meta('jobInputSchema'),
  outputSchema: tokenFactory.meta('jobOutputSchema'),
  timeout: tokenFactory.meta('jobTimeout'),
  retry: tokenFactory.meta('jobRetry'),
  tags: tokenFactory.meta('jobTags'),
  labels: tokenFactory.meta('jobLabels'),
  hideFromDiscovery: tokenFactory.meta('jobHideFromDiscovery'),
  permissions: tokenFactory.meta('jobPermissions'),
  metadata: tokenFactory.meta('jobMetadata'),
} as const satisfies RawMetadataShape<JobMetadata, ExtendFrontMcpJobMetadata>;

export const extendedJobMetadata = tokenFactory.meta('extendedJobMetadata');
