import { RawMetadataShape } from '../types';
import { TokenHookMetadata } from '../metadata';
import { tokenFactory } from './base.tokens';

export const FrontMcpFlowHookTokens = {
  type: tokenFactory.type('hooks'),
  hooks: tokenFactory.meta('hooks'), // used for aggregate hooks in a target class
} as const satisfies RawMetadataShape<TokenHookMetadata>;
