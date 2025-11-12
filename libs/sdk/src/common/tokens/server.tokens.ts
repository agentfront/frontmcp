import { tokenFactory } from './base.tokens';
import { HttpRequestIntent } from '../utils';
import { Authorization, RawMetadataShape } from '../types';

interface ServerRequestTokenValue {
  intent: HttpRequestIntent;
  auth: Authorization;
  sessionId: string;
}

export const ServerRequestTokens = {
  type: tokenFactory.type('serverRequest'),
  intent: tokenFactory.meta('intent'),
  auth: tokenFactory.meta('auth'),
  sessionId: tokenFactory.meta('sessionId'),
} satisfies RawMetadataShape<ServerRequestTokenValue>;