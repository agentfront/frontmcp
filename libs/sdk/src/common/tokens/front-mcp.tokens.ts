import { tokenFactory } from './base.tokens';
import { RawMetadataShape } from '../types';
import { FrontMcpMetadata } from '../metadata';

export const FrontMcpTokens: RawMetadataShape<FrontMcpMetadata> = {
  type: tokenFactory.type('root'),
  info: tokenFactory.meta('info'),
  apps: tokenFactory.meta('apps'),
  http: tokenFactory.meta('http'),
  session: tokenFactory.meta('session'),
  serve: tokenFactory.meta('serve'),
  splitByApp: tokenFactory.meta('splitByApp'),
  auth: tokenFactory.meta('auth'),
  logging: tokenFactory.meta('logging'),

  // global scoped providers
  providers: tokenFactory.meta('providers'),
  // TODO: FEATURE/FRONT_MCP_METADATA - add support for global plugins across apps
};