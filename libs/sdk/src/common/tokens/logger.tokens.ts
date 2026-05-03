import { type LogTransportMetadata } from '../metadata';
import { type RawMetadataShape } from '../types';
import { tokenFactory } from './base.tokens';

export const FrontMcpLogTransportTokens: RawMetadataShape<LogTransportMetadata> = {
  type: tokenFactory.type('logger'),
  id: tokenFactory.meta('id'),
  name: tokenFactory.meta('name'),
  description: tokenFactory.meta('description'),
} as const;
