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
  // global scoped skills (shared across apps)
  skills: tokenFactory.meta('skills'),
  // server-level plugins (instantiated per scope)
  plugins: tokenFactory.meta('plugins'),
  // pagination configuration
  pagination: tokenFactory.meta('pagination'),
  // elicitation configuration
  elicitation: tokenFactory.meta('elicitation'),
  // skills HTTP configuration
  skillsConfig: tokenFactory.meta('skillsConfig'),
  // ext-apps configuration
  extApps: tokenFactory.meta('extApps'),
  // sqlite storage configuration
  sqlite: tokenFactory.meta('sqlite'),
  // jobs and workflows configuration
  jobs: tokenFactory.meta('jobs'),
};
