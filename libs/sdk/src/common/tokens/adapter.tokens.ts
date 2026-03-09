import { tokenFactory } from './base.tokens';
import { RawMetadataShape } from '../types';
import { AdapterMetadata } from '../metadata';

export const FrontMcpAdapterTokens: RawMetadataShape<AdapterMetadata> = {
  type: tokenFactory.type('adapter'),
  id: tokenFactory.meta('id'),
  name: tokenFactory.meta('name'),
  description: tokenFactory.meta('description'),
} as const;
