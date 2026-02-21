import { tokenFactory } from './base.tokens';
import { RawMetadataShape } from '../types';
import { SkillMetadata } from '../metadata';

export const FrontMcpSkillTokens = {
  type: tokenFactory.type('skill'),
  id: tokenFactory.meta('skill:id'),
  name: tokenFactory.meta('skill:name'),
  description: tokenFactory.meta('skill:description'),
  instructions: tokenFactory.meta('skill:instructions'),
  tools: tokenFactory.meta('skill:tools'),
  tags: tokenFactory.meta('skill:tags'),
  parameters: tokenFactory.meta('skill:parameters'),
  examples: tokenFactory.meta('skill:examples'),
  priority: tokenFactory.meta('skill:priority'),
  hideFromDiscovery: tokenFactory.meta('skill:hideFromDiscovery'),
  toolValidation: tokenFactory.meta('skill:toolValidation'),
  visibility: tokenFactory.meta('skill:visibility'),
  license: tokenFactory.meta('skill:license'),
  compatibility: tokenFactory.meta('skill:compatibility'),
  specMetadata: tokenFactory.meta('skill:specMetadata'),
  allowedTools: tokenFactory.meta('skill:allowedTools'),
  resources: tokenFactory.meta('skill:resources'),
  metadata: tokenFactory.meta('skill:metadata'), // used in skill({}) construction
} as const satisfies RawMetadataShape<SkillMetadata, ExtendFrontMcpSkillMetadata>;

export const extendedSkillMetadata = tokenFactory.meta('extendedSkillMetadata');
