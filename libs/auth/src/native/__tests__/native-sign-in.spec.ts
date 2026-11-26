/**
 * Unit tests of native sign-in. The flows over real HTTP, against a small authorization server on a loopback port,
 * are in apps/e2e/demo-e2e-transparent/e2e/native-sign-in-client.e2e.spec.ts.
 */
import { authorizationServerMetadataUrls } from '..';

describe('authorizationServerMetadataUrls', () => {
  it('tries the RFC 8414 document, then the OpenID one', () => {
    expect(authorizationServerMetadataUrls('https://auth.example.com/')).toEqual([
      'https://auth.example.com/.well-known/oauth-authorization-server',
      'https://auth.example.com/.well-known/openid-configuration',
    ]);
  });

  it('inserts an issuer path after the well-known segment, then appends it the OpenID way', () => {
    expect(authorizationServerMetadataUrls('https://auth.example.com/tenants/acme')).toEqual([
      'https://auth.example.com/.well-known/oauth-authorization-server/tenants/acme',
      'https://auth.example.com/.well-known/openid-configuration/tenants/acme',
      'https://auth.example.com/tenants/acme/.well-known/openid-configuration',
    ]);
  });
});
