import { type Token } from '@frontmcp/di';

import { type EventPublisher } from '../interfaces/event.interface';
import { tokenFactory } from './base.tokens';

export const FrontMcpEventTokens = {
  type: tokenFactory.type('event'),
  metadata: tokenFactory.meta('eventMetadata'),
} as const;

/** The server's event publisher, for a provider, a duty or a worker: `this.get(EVENT_PUBLISHER)`. */
export const EVENT_PUBLISHER = Symbol.for('frontmcp:EVENT_PUBLISHER') as Token<EventPublisher>;
