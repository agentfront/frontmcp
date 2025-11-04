import { tokenFactory } from './base.tokens';
import { RawMetadataShape } from '../types';
import { LogTransportMetadata } from '../metadata';


export const FrontMcpLogTransportTokens: RawMetadataShape<LogTransportMetadata> = {
  type: tokenFactory.type('logger'),
  id: tokenFactory.meta('id'),
  name: tokenFactory.meta('name'),
  description: tokenFactory.meta('description'),
} as const;
