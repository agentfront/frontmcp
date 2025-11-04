import { tokenFactory } from './base.tokens';
import { RawMetadataShape } from '../types';
import { AuthProviderMetadata } from '../metadata';
import { FrontMcpPluginTokens } from './plugin.tokens';


export const FrontMcpAuthProviderTokens: RawMetadataShape<AuthProviderMetadata> = {
  type: tokenFactory.type('auth-provider'),
  id: tokenFactory.meta('id'),
  name: tokenFactory.meta('name'),
  description: tokenFactory.meta('description'),
  scope: tokenFactory.meta('scope'),
} as const;
