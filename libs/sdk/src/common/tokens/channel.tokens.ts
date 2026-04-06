import { tokenFactory } from './base.tokens';
import { RawMetadataShape } from '../types';
import { ChannelMetadata } from '../metadata';

export const FrontMcpChannelTokens = {
  type: tokenFactory.type('channel'),
  name: tokenFactory.meta('name'),
  description: tokenFactory.meta('description'),
  source: tokenFactory.meta('source'),
  twoWay: tokenFactory.meta('twoWay'),
  meta: tokenFactory.meta('meta'),
  replay: tokenFactory.meta('replay'),
  tools: tokenFactory.meta('tools'),
  tags: tokenFactory.meta('tags'),
  availableWhen: tokenFactory.meta('availableWhen'),
  metadata: tokenFactory.meta('metadata'), // used in channel({}) construction
} as const satisfies RawMetadataShape<ChannelMetadata, ExtendFrontMcpChannelMetadata>;
