import { tokenFactory } from './base.tokens';

export const FrontMcpEventTokens = {
  type: tokenFactory.type('event'),
  metadata: tokenFactory.meta('eventMetadata'),
} as const;
