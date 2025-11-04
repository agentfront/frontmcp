import { tokenFactory } from './base.tokens';
import { RawMetadataShape } from '../types';
import { ResourceMetadata, ResourceTemplateMetadata } from '../metadata';


export const FrontMcpResourceTokens = {
  type: tokenFactory.type('resource'),
  name: tokenFactory.meta('name'),
  title: tokenFactory.meta('title'),
  uri: tokenFactory.meta('uri'),
  description: tokenFactory.meta('description'),
  mimeType: tokenFactory.meta('mimeType'),
  icons: tokenFactory.meta('icons'),
  metadata: tokenFactory.meta('metadata'), // used in resource({}) construction
} as const satisfies RawMetadataShape<ResourceMetadata, ExtendFrontMcpResourceMetadata>;

export const FrontMcpResourceTemplateTokens = {
  type: tokenFactory.type('resourceTemplate'),
  name: tokenFactory.meta('name'),
  title: tokenFactory.meta('title'),
  uriTemplate: tokenFactory.meta('uriTemplate'),
  description: tokenFactory.meta('description'),
  mimeType: tokenFactory.meta('mimeType'),
  icons: tokenFactory.meta('icons'),
  metadata: tokenFactory.meta('metadata'), // used in resourceTemplate({}) construction
} as const satisfies RawMetadataShape<ResourceTemplateMetadata, ExtendFrontMcpResourceTemplateMetadata>;

