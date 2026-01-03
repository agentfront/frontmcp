import { tokenFactory } from './base.tokens';
import { RawMetadataShape } from '../types';
import { PluginMetadata } from '../metadata';

export const FrontMcpPluginTokens = {
  type: tokenFactory.type('plugin'),
  id: tokenFactory.meta('id'),
  name: tokenFactory.meta('name'),
  description: tokenFactory.meta('description'),
  providers: tokenFactory.meta('providers'),
  exports: tokenFactory.meta('exports'),
  plugins: tokenFactory.meta('plugins'),
  adapters: tokenFactory.meta('adapters'),
  tools: tokenFactory.meta('tools'),
  resources: tokenFactory.meta('resources'),
  prompts: tokenFactory.meta('prompts'),
  scope: tokenFactory.meta('scope'),
} as const satisfies RawMetadataShape<PluginMetadata>;
