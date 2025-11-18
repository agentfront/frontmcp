import { tokenFactory } from './base.tokens';
import { RawMetadataShape } from '../types';
import { ToolMetadata } from '../metadata';

export const FrontMcpToolTokens = {
  type: tokenFactory.type('tool'),
  id: tokenFactory.meta('id'),
  name: tokenFactory.meta('name'),
  description: tokenFactory.meta('description'),
  inputSchema: tokenFactory.meta('inputSchema'),
  inputJsonSchema: tokenFactory.meta('inputJsonSchema'),
  outputSchema: tokenFactory.meta('outputSchema'),
  tags: tokenFactory.meta('tags'),
  annotations: tokenFactory.meta('annotations'),
  hideFromDiscovery: tokenFactory.meta('hideFromDiscovery'),
  metadata: tokenFactory.meta('metadata'), // used in tool({}) construction
} as const satisfies RawMetadataShape<ToolMetadata, ExtendFrontMcpToolMetadata>;

export const extendedToolMetadata = tokenFactory.meta('extendedToolMetadata');
