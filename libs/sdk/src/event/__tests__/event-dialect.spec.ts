import { EVENTS_ERROR_CODES, EVENTS_SKETCH_ERROR_CODES } from '@frontmcp/protocol';

import { type ScopeEntry } from '../../common';
import { callerPlatformOf, EVENT_DIALECTS, resolveEventDialect } from '../event-dialect';

function scopeWithSessionPlatform(platform: string): ScopeEntry {
  return { notifications: { getPlatformType: jest.fn().mockReturnValue(platform) } } as unknown as ScopeEntry;
}

describe('event dialects', () => {
  it('gives SEP-3415 its own error codes, a message id per delivery and the control envelopes', () => {
    expect(EVENT_DIALECTS['sep-3415']).toEqual({
      errorCodes: EVENTS_ERROR_CODES,
      webhookId: 'message',
      sendsControlEnvelopes: true,
    });
  });

  it('gives the sketch its error codes, the event id as webhook-id and no control envelopes', () => {
    expect(EVENT_DIALECTS.sketch).toEqual({
      errorCodes: EVENTS_SKETCH_ERROR_CODES,
      webhookId: 'eventId',
      sendsControlEnvelopes: false,
    });
  });

  describe('resolveEventDialect', () => {
    it('answers an OpenAI caller in the sketch under auto', () => {
      expect(resolveEventDialect('auto', 'openai')).toBe('sketch');
    });

    it.each(['claude', 'generic-mcp', 'unknown'] as const)('answers a %s caller in SEP-3415 under auto', (platform) => {
      expect(resolveEventDialect('auto', platform)).toBe('sep-3415');
    });

    it.each(['sep-3415', 'sketch'] as const)('answers every caller in %s when compat pins it', (compat) => {
      expect(resolveEventDialect(compat, 'openai')).toBe(compat);
      expect(resolveEventDialect(compat, 'claude')).toBe(compat);
    });
  });

  describe('callerPlatformOf', () => {
    it('reads the platform of the session id first', () => {
      const scope = scopeWithSessionPlatform('claude');
      const authInfo = { sessionId: 'session-1', sessionIdPayload: { platformType: 'openai' } } as never;

      expect(callerPlatformOf(scope, authInfo, 'cursor')).toBe('openai');
    });

    it('reads the platform of the request when the session id names none', () => {
      const scope = scopeWithSessionPlatform('claude');
      const authInfo = { sessionId: 'session-1', sessionIdPayload: { platformType: 'unknown' } } as never;

      expect(callerPlatformOf(scope, authInfo, 'cursor')).toBe('cursor');
    });

    it('falls back to the client info the session gave at initialize', () => {
      const scope = scopeWithSessionPlatform('openai');

      expect(callerPlatformOf(scope, { sessionId: 'session-1' }, 'unknown')).toBe('openai');
      expect(scope.notifications.getPlatformType).toHaveBeenCalledWith('session-1');
    });

    it('is unknown for a caller without a session', () => {
      expect(callerPlatformOf(scopeWithSessionPlatform('openai'), {}, undefined)).toBe('unknown');
    });
  });
});
