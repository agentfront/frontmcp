import { type ProviderMetadata } from '../metadata';
import { type RawMetadataShape } from '../types';
import { tokenFactory } from './base.tokens';

export const FrontMcpProviderTokens: RawMetadataShape<ProviderMetadata> = {
  type: tokenFactory.type('provider'),
  id: tokenFactory.meta('id'),
  name: tokenFactory.meta('name'),
  description: tokenFactory.meta('description'),
  scope: tokenFactory.meta('scope'),
} as const;
