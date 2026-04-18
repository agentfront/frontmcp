import { type ToolMetadata } from '../metadata';
import { type RawMetadataShape } from '../types';
import { tokenFactory } from './base.tokens';

export const FrontMcpToolTokens = {
  type: tokenFactory.type('tool'),
  id: tokenFactory.meta('id'),
  name: tokenFactory.meta('name'),
  description: tokenFactory.meta('description'),
  inputSchema: tokenFactory.meta('inputSchema'),
  outputSchema: tokenFactory.meta('outputSchema'),
  tags: tokenFactory.meta('tags'),
  annotations: tokenFactory.meta('annotations'),
  hideFromDiscovery: tokenFactory.meta('hideFromDiscovery'),
  examples: tokenFactory.meta('examples'),
  ui: tokenFactory.meta('ui'), // UI template configuration
  metadata: tokenFactory.meta('metadata'), // used in tool({}) construction
  authProviders: tokenFactory.meta('authProviders'), // Auth provider refs (array)
  rateLimit: tokenFactory.meta('rateLimit'), // Rate limiting configuration
  concurrency: tokenFactory.meta('concurrency'), // Concurrency control configuration
  timeout: tokenFactory.meta('timeout'), // Timeout configuration
  availableWhen: tokenFactory.meta('availableWhen'), // Environment availability constraint
  execution: tokenFactory.meta('execution'), // Execution hints (taskSupport, etc.)
} as const satisfies RawMetadataShape<ToolMetadata, ExtendFrontMcpToolMetadata>;

export const extendedToolMetadata = tokenFactory.meta('extendedToolMetadata');
