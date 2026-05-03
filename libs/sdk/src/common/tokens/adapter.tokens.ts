import { type AdapterMetadata } from '../metadata';
import { type RawMetadataShape } from '../types';
import { tokenFactory } from './base.tokens';

export const FrontMcpAdapterTokens: RawMetadataShape<AdapterMetadata> = {
  type: tokenFactory.type('adapter'),
  id: tokenFactory.meta('id'),
  name: tokenFactory.meta('name'),
  description: tokenFactory.meta('description'),
} as const;
