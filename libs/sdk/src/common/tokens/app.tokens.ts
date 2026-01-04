import { tokenFactory } from './base.tokens';
import { RawMetadataShape } from '../types';
import { LocalAppMetadata, RemoteAppMetadata } from '../metadata';

export const FrontMcpLocalAppTokens: RawMetadataShape<LocalAppMetadata> = {
  type: tokenFactory.type('app'),
  auth: tokenFactory.meta('auth'),
  id: tokenFactory.meta('id'),
  name: tokenFactory.meta('name'),
  description: tokenFactory.meta('description'),
  providers: tokenFactory.meta('providers'),
  authProviders: tokenFactory.meta('authProviders'),
  plugins: tokenFactory.meta('plugins'),
  adapters: tokenFactory.meta('adapters'),
  tools: tokenFactory.meta('tools'),
  resources: tokenFactory.meta('resources'),
  prompts: tokenFactory.meta('prompts'),
  agents: tokenFactory.meta('agents'),
  standalone: tokenFactory.meta('standalone'),
} as const;

export const FrontMcpRemoteAppTokens: RawMetadataShape<RemoteAppMetadata> = {
  type: tokenFactory.type('app'),
  auth: tokenFactory.meta('auth'),
  id: tokenFactory.meta('id'),
  name: tokenFactory.meta('name'),
  description: tokenFactory.meta('description'),
  urlType: tokenFactory.meta('urlType'),
  url: tokenFactory.meta('url'),
  namespace: tokenFactory.meta('namespace'),
  transportOptions: tokenFactory.meta('transportOptions'),
  remoteAuth: tokenFactory.meta('remoteAuth'),
  refreshInterval: tokenFactory.meta('refreshInterval'),
  standalone: tokenFactory.meta('standalone'),
} as const;
