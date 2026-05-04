import { type FlowMetadata } from '../metadata';
import { type RawMetadataShape } from '../types';
import { tokenFactory } from './base.tokens';

export const FrontMcpFlowTokens = {
  type: tokenFactory.type('flow'),
  name: tokenFactory.meta('name'),
  description: tokenFactory.meta('description'),
  plan: tokenFactory.meta('plan'),
  inputSchema: tokenFactory.meta('inputSchema'),
  outputSchema: tokenFactory.meta('outputSchema'),
  access: tokenFactory.meta('access'),
  dependsOn: tokenFactory.meta('dependsOn'),
  middleware: tokenFactory.meta('middleware'),
} as const satisfies RawMetadataShape<FlowMetadata<never>>;
