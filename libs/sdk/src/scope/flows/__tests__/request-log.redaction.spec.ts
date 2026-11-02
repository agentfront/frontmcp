import { headerValueForLog, isCredentialName, isSessionIdName } from '../request-log.redaction';

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
    'passWord',
    'X-PassWord',
    'pageToken',
    'x_api_key',
    'accesstoken',
    'x-amzn-oidc-accesstoken',
    'clientsecret',
    'dbPassword',
    'x-goog-iap-jwt-assertion',
    'passphrase',
  ])('names a credential: %s', (name) => {
    expect(isCredentialName(name)).toBe(true);
  });

  it.each(['city', 'keyboard', 'tokens', 'monkey', 'turkey', 'www-authenticate', 'sessionId', 'pwd'])(
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

describe('isSessionIdName', () => {
  it.each(['mcp-session-id', 'x-frontmcp-session-id', 'sessionId', 'session_id', 'mcpSessionId'])(
    'names a session id: %s',
    (name) => {
      expect(isSessionIdName(name)).toBe(true);
    },
  );

  it.each(['session', 'sessions', 'sessionIdle'])('names no session id: %s', (name) => {
    expect(isSessionIdName(name)).toBe(false);
  });
});
