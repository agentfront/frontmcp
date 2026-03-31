import { tokenFactory } from './base.tokens';
import { HttpRequestIntent } from '../utils';
import { Authorization, RawMetadataShape } from '../types';

interface ServerRequestTokenValue {
  intent: HttpRequestIntent;
  auth: Authorization;
  sessionId: string;
  /** Set when a terminated session is being re-initialized (unmarked from terminated set). */
  reinitialize: boolean;
}

export const ServerRequestTokens = {
  type: tokenFactory.type('serverRequest'),
  intent: tokenFactory.meta('intent'),
  auth: tokenFactory.meta('auth'),
  sessionId: tokenFactory.meta('sessionId'),
  reinitialize: tokenFactory.meta('reinitialize'),
} satisfies RawMetadataShape<ServerRequestTokenValue>;
