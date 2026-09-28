/**
 * `assertRequestHasCredential` checks the request as built, after `additionalHeaders` and
 * `headersMapper`. An `Authorization` header counts for an HTTP, OAuth2 or OpenID Connect scheme
 * only when it carries that scheme's credential: `Bearer attacker-token` set by a `headersMapper`
 * is no HTTP Basic credential. A header API key only has to be present.
 */

import type { McpOpenAPITool } from 'mcp-from-openapi';

import { assertRequestHasCredential } from '../openapi.security';

type Security = { scheme: string; type: string; httpScheme?: string };

function toolWith(security: Security, key = 'Authorization'): McpOpenAPITool {
  return {
    name: 'op',
    mapper: [{ inputKey: 'auth', type: 'header', key, required: true, security }],
  } as unknown as McpOpenAPITool;
}

const URL_ = 'https://api.example.com/op';
const withAuthorization = (value: string) => new Headers({ Authorization: value });

describe('assertRequestHasCredential: the Authorization header must fit the scheme', () => {
  const basic = toolWith({ scheme: 'BasicAuth', type: 'http', httpScheme: 'basic' });
  const bearer = toolWith({ scheme: 'BearerAuth', type: 'http', httpScheme: 'bearer' });
  const oauth2 = toolWith({ scheme: 'OAuth', type: 'oauth2' });
  const oidc = toolWith({ scheme: 'Oidc', type: 'openIdConnect' });

  it.each([
    ['an HTTP Basic scheme given a bearer token', basic, 'Bearer attacker-token'],
    ['an HTTP bearer scheme given Basic credentials', bearer, 'Basic dXNlcjpwYXNz'],
    ['an OAuth2 scheme given Basic credentials', oauth2, 'Basic dXNlcjpwYXNz'],
    ['an OpenID Connect scheme given a raw token', oidc, 'raw-token'],
    ['an HTTP bearer scheme given the scheme word alone', bearer, 'Bearer'],
    ['an HTTP bearer scheme given the scheme word and blanks', bearer, 'Bearer   '],
  ])('refuses %s', (_label, tool, value) => {
    expect(() => assertRequestHasCredential(tool, URL_, withAuthorization(value))).toThrow(
      /Authentication required for tool 'op'/,
    );
  });

  it.each([
    ['an HTTP Basic scheme', basic, 'Basic dXNlcjpwYXNz'],
    ['an HTTP bearer scheme', bearer, 'Bearer token-1'],
    ['an HTTP bearer scheme, in any case', bearer, 'bearer token-1'],
    ['an OAuth2 scheme', oauth2, 'Bearer token-1'],
    ['an OpenID Connect scheme', oidc, 'Bearer token-1'],
  ])('accepts %s with its own credential', (_label, tool, value) => {
    expect(() => assertRequestHasCredential(tool, URL_, withAuthorization(value))).not.toThrow();
  });

  it('treats an HTTP scheme without a named scheme as bearer', () => {
    const unnamed = toolWith({ scheme: 'Token', type: 'http' });
    expect(() => assertRequestHasCredential(unnamed, URL_, withAuthorization('Bearer t'))).not.toThrow();
    expect(() => assertRequestHasCredential(unnamed, URL_, withAuthorization('Basic dXNlcjpwYXNz'))).toThrow();
  });

  it('accepts any non-empty value for an API key, even one sent as Authorization', () => {
    const apiKeyInAuthorization = toolWith({ scheme: 'Key', type: 'apiKey' });
    const apiKeyHeader = toolWith({ scheme: 'Key', type: 'apiKey' }, 'X-Api-Key');

    expect(() => assertRequestHasCredential(apiKeyInAuthorization, URL_, withAuthorization('raw-key'))).not.toThrow();
    expect(() => assertRequestHasCredential(apiKeyHeader, URL_, new Headers({ 'X-Api-Key': 'k' }))).not.toThrow();
    expect(() => assertRequestHasCredential(apiKeyHeader, URL_, new Headers())).toThrow();
  });
});
