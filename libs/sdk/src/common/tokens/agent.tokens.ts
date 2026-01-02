import { tokenFactory } from './base.tokens';
import { RawMetadataShape } from '../types';
import { AgentMetadata } from '../metadata';

/**
 * Tokens for AgentMetadata properties.
 * Used by the @Agent decorator to store metadata on decorated classes.
 */
export const FrontMcpAgentTokens = {
  type: tokenFactory.type('agent'),
  id: tokenFactory.meta('id'),
  name: tokenFactory.meta('name'),
  description: tokenFactory.meta('description'),
  systemInstructions: tokenFactory.meta('systemInstructions'),
  inputSchema: tokenFactory.meta('inputSchema'),
  outputSchema: tokenFactory.meta('outputSchema'),
  llm: tokenFactory.meta('llm'),
  providers: tokenFactory.meta('providers'),
  plugins: tokenFactory.meta('plugins'),
  adapters: tokenFactory.meta('adapters'),
  agents: tokenFactory.meta('agents'),
  tools: tokenFactory.meta('tools'),
  resources: tokenFactory.meta('resources'),
  prompts: tokenFactory.meta('prompts'),
  exports: tokenFactory.meta('exports'),
  swarm: tokenFactory.meta('swarm'),
  execution: tokenFactory.meta('execution'),
  tags: tokenFactory.meta('tags'),
  hideFromDiscovery: tokenFactory.meta('hideFromDiscovery'),
  metadata: tokenFactory.meta('metadata'), // used in agent({}) function construction
} as const satisfies RawMetadataShape<AgentMetadata, ExtendFrontMcpAgentMetadata>;

/**
 * Token for storing extended (user-defined) agent metadata that doesn't
 * have a dedicated token.
 */
export const extendedAgentMetadata = tokenFactory.meta('extendedAgentMetadata');
