import { tokenFactory } from './base.tokens';
import { RawMetadataShape } from '../types';
import { PromptMetadata } from '../metadata';

export const FrontMcpPromptTokens = {
  type: tokenFactory.type('prompt'),
  name: tokenFactory.meta('name'),
  title: tokenFactory.meta('title'),
  arguments: tokenFactory.meta('arguments'),
  description: tokenFactory.meta('description'),
  icons: tokenFactory.meta('icons'),
  metadata: tokenFactory.meta('metadata'), // used in prompt({}) construction
} as const satisfies RawMetadataShape<PromptMetadata, ExtendFrontMcpPromptMetadata>;
