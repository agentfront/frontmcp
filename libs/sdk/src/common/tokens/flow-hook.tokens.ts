import { type TokenHookMetadata } from '../metadata';
import { type RawMetadataShape } from '../types';
import { tokenFactory } from './base.tokens';

export const FrontMcpFlowHookTokens = {
  type: tokenFactory.type('hooks'),
  hooks: tokenFactory.meta('hooks'), // used for aggregate hooks in a target class
} as const satisfies RawMetadataShape<TokenHookMetadata>;
