import { RawMetadataShape } from '../types';
import { FlowHookMetadata } from '../metadata';
import { tokenFactory } from './base.tokens';

export const FrontMcpFlowHookTokens = {
  type: tokenFactory.type('flow'),
  hooks: tokenFactory.meta('hooks'),
} as const satisfies RawMetadataShape<FlowHookMetadata>;

