import { generatePkcePair, sha256Base64url } from '@frontmcp/utils';

import { MockOAuthServer, type MockOAuthServerOptions } from '../mock-oauth-server';
import { TestTokenFactory } from '../token-factory';

const REDIRECT_URI = 'http://127.0.0.1:4100/callback';

describe('MockOAuthServer PKCE modes', () => {
  let server: MockOAuthServer;
  let warn: jest.SpyInstance;

  async function start(pkce?: MockOAuthServerOptions['pkce']): Promise<void> {
    server = new MockOAuthServer(new TestTokenFactory(), {
      autoApprove: true,
      testUser: { sub: 'pkce-user' },
      clientId: 'pkce-client',
      validRedirectUris: [REDIRECT_URI],
      pkce,
    });
    await server.start();
  }

  /** The authorization redirect's parameters. */
  async function authorize(params: Record<string, string>): Promise<URLSearchParams> {
    const url = new URL(`${server.info.baseUrl}/oauth/authorize`);
    const query = {
      client_id: 'pkce-client',
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      state: 's1',
      ...params,
    };
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    const response = await fetch(url, { redirect: 'manual' });
    expect(response.status).toBe(302);
    return new URL(response.headers.get('location') as string).searchParams;
  }

  async function exchange(
    code: string,
    codeVerifier?: string,
  ): Promise<{ status: number; body: Record<string, string> }> {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: 'pkce-client',
    });
    if (codeVerifier !== undefined) form.set('code_verifier', codeVerifier);
    const response = await fetch(`${server.info.baseUrl}/oauth/token`, { method: 'POST', body: form });
    return { status: response.status, body: await response.json() };
  }

  async function metadata(): Promise<Record<string, unknown>> {
    return (await fetch(`${server.info.baseUrl}/.well-known/oauth-authorization-server`)).json();
  }

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await server.stop();
    warn.mockRestore();
  });

  describe("pkce: 'strict'", () => {
    beforeEach(() => start('strict'));

    it('signs in with S256', async () => {
      const { codeVerifier, codeChallenge } = generatePkcePair();
      const redirect = await authorize({ code_challenge: codeChallenge, code_challenge_method: 'S256' });

      const { status, body } = await exchange(redirect.get('code') as string, codeVerifier);

      expect(status).toBe(200);
      expect(body.access_token).toBeDefined();
    });

    it.each([
      ['no code_challenge', {}, 'code_challenge is missing'],
      [
        'the plain method',
        { code_challenge: 'a'.repeat(43), code_challenge_method: 'plain' },
        'code_challenge_method plain is not S256',
      ],
      ['no method, which means plain', { code_challenge: 'a'.repeat(43) }, 'code_challenge_method plain is not S256'],
    ])('redirects a request with %s back with invalid_request and no code', async (_name, params, problem) => {
      const redirect = await authorize(params);

      expect(redirect.get('code')).toBeNull();
      expect(redirect.get('error')).toBe('invalid_request');
      expect(redirect.get('error_description')).toBe(`S256 PKCE is required: ${problem}`);
      expect(redirect.get('state')).toBe('s1');
    });

    it('refuses a code_verifier that is not 43-128 unreserved characters, even when it hashes to the challenge', async () => {
      const verifier = 'short';
      const redirect = await authorize({ code_challenge: sha256Base64url(verifier), code_challenge_method: 'S256' });

      const { status, body } = await exchange(redirect.get('code') as string, verifier);

      expect(status).toBe(400);
      expect(body).toMatchObject({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    });

    it('refuses the manual sign-in form without S256', async () => {
      const form = new URLSearchParams({
        client_id: 'pkce-client',
        redirect_uri: REDIRECT_URI,
        sub: 'u',
        action: 'approve',
      });
      const response = await fetch(`${server.info.baseUrl}/oauth/authorize/submit`, {
        method: 'POST',
        body: form,
        redirect: 'manual',
      });

      const redirect = new URL(response.headers.get('location') as string).searchParams;
      expect(redirect.get('error')).toBe('invalid_request');
      expect(redirect.get('code')).toBeNull();
    });

    it('advertises S256 only', async () => {
      expect((await metadata())['code_challenge_methods_supported']).toEqual(['S256']);
    });

    it('does not warn', async () => {
      await authorize({});
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('unset (the default)', () => {
    beforeEach(() => start());

    it('still signs in without PKCE, and warns once, naming the option', async () => {
      const first = await authorize({});
      const second = await authorize({ code_challenge: 'plain-challenge', code_challenge_method: 'plain' });

      expect((await exchange(first.get('code') as string)).status).toBe(200);
      expect((await exchange(second.get('code') as string, 'plain-challenge')).status).toBe(200);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("Set pkce: 'strict'");
    });

    it('advertises no challenge methods, as before', async () => {
      expect(await metadata()).not.toHaveProperty('code_challenge_methods_supported');
    });
  });

  describe("pkce: 'lenient'", () => {
    beforeEach(() => start('lenient'));

    it('signs in without PKCE and does not warn', async () => {
      const redirect = await authorize({});

      expect((await exchange(redirect.get('code') as string)).status).toBe(200);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
