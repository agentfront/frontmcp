import { tokenFactory } from './base.tokens';
import { RawMetadataShape } from '../types';
import { FrontMcpMetadata } from '../metadata';

export const FrontMcpTokens: RawMetadataShape<FrontMcpMetadata> = {
  type: tokenFactory.type('root'),
  info: tokenFactory.meta('info'),
  apps: tokenFactory.meta('apps'),
  http: tokenFactory.meta('http'),
  redis: tokenFactory.meta('redis'),
  pubsub: tokenFactory.meta('pubsub'),
  transport: tokenFactory.meta('transport'),
  session: tokenFactory.meta('session'), // @deprecated - kept for backward compatibility
  serve: tokenFactory.meta('serve'),
  splitByApp: tokenFactory.meta('splitByApp'),
  auth: tokenFactory.meta('auth'),
  logging: tokenFactory.meta('logging'),

  // global scoped providers
  providers: tokenFactory.meta('providers'),
  // global scoped tools (shared across apps)
  tools: tokenFactory.meta('tools'),
  // global scoped resources (shared across apps)
  resources: tokenFactory.meta('resources'),
  // server-level plugins (instantiated per scope)
  plugins: tokenFactory.meta('plugins'),
  // pagination configuration
  pagination: tokenFactory.meta('pagination'),
  // elicitation configuration
  elicitation: tokenFactory.meta('elicitation'),
};
