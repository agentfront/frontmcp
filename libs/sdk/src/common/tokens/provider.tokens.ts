import { tokenFactory } from './base.tokens';
import { RawMetadataShape } from '../types';
import { ProviderMetadata } from '../metadata';


export const FrontMcpProviderTokens: RawMetadataShape<ProviderMetadata> = {
  type: tokenFactory.type('provider'),
  id: tokenFactory.meta('id'),
  name: tokenFactory.meta('name'),
  description: tokenFactory.meta('description'),
  scope: tokenFactory.meta('scope'),
} as const;

