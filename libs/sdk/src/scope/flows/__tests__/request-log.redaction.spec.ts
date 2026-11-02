import { headerValueForLog, isCredentialName } from '../request-log.redaction';

describe('isCredentialName', () => {
  it.each([
    'authorization',
    'Cookie',
    'x-api-key',
    'apiKey',
    'api_key',
    'accessToken',
    'client_secret',
    'password',
    'OAuthToken',
  ])('names a credential: %s', (name) => {
    expect(isCredentialName(name)).toBe(true);
  });

  it.each(['city', 'keyboard', 'tokens', 'monkey', 'www-authenticate', 'sessionId'])(
    'names no credential: %s',
    (name) => {
      expect(isCredentialName(name)).toBe(false);
    },
  );
});

describe('headerValueForLog', () => {
  it('hides a credential header and shortens a session id', () => {
    expect(headerValueForLog('x-auth-token', 'abc')).toBe('[REDACTED]');
    expect(headerValueForLog('mcp-session-id', '0123456789abcdef')).toBe('01234567...');
  });
});
