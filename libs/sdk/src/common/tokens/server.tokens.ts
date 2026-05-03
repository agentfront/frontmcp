import { type Authorization, type RawMetadataShape } from '../types';
import { type HttpRequestIntent } from '../utils';
import { tokenFactory } from './base.tokens';

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
