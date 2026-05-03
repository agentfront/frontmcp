import { type AuthProviderMetadata } from '../metadata';
import { type RawMetadataShape } from '../types';
import { tokenFactory } from './base.tokens';

export const FrontMcpAuthProviderTokens: RawMetadataShape<AuthProviderMetadata> = {
  type: tokenFactory.type('auth-provider'),
  id: tokenFactory.meta('id'),
  name: tokenFactory.meta('name'),
  description: tokenFactory.meta('description'),
  scope: tokenFactory.meta('scope'),
} as const;
