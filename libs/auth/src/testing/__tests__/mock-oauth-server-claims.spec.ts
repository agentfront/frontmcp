import { MockOAuthServer, type MockOAuthServerOptions } from '../mock-oauth-server';
import { TestTokenFactory } from '../token-factory';

const REDIRECT_URI = 'http://127.0.0.1:4200/callback';
const NOTES = 'https://notes.example.com/mcp';
const TASKS = 'https://tasks.example.com/mcp';

const decode = (token: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

describe('MockOAuthServer tokens: auth_time, resource indicators and several users', () => {
  let server: MockOAuthServer;
  let warn: jest.SpyInstance;

  async function start(options: MockOAuthServerOptions): Promise<void> {
    server = new MockOAuthServer(new TestTokenFactory({ audience: 'default-audience' }), {
      autoApprove: true,
      clientId: 'c',
      validRedirectUris: [REDIRECT_URI],
      pkce: 'lenient',
      ...options,
    });
    await server.start();
  }

  async function authorize(params: Record<string, string | string[]> = {}): Promise<URLSearchParams> {
    const url = new URL(`${server.info.baseUrl}/oauth/authorize`);
    const query = { client_id: 'c', redirect_uri: REDIRECT_URI, response_type: 'code', state: 's', ...params };
    for (const [name, value] of Object.entries(query)) {
      for (const one of Array.isArray(value) ? value : [value]) url.searchParams.append(name, one);
    }
    const response = await fetch(url, { redirect: 'manual' });
    return new URL(response.headers.get('location') as string).searchParams;
  }

  async function token(
    form: Record<string, string | string[]>,
  ): Promise<{ status: number; body: Record<string, string> }> {
    const body = new URLSearchParams({ client_id: 'c' });
    for (const [name, value] of Object.entries(form)) {
      for (const one of Array.isArray(value) ? value : [value]) body.append(name, one);
    }
    const response = await fetch(`${server.info.baseUrl}/oauth/token`, { method: 'POST', body });
    return { status: response.status, body: await response.json() };
  }

  async function signIn(
    params: Record<string, string | string[]> = {},
    tokenParams: Record<string, string | string[]> = {},
  ) {
    const code = (await authorize(params)).get('code') as string;
    return token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, ...tokenParams });
  }

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await server.stop();
    jest.restoreAllMocks();
  });

  describe('auth_time', () => {
    it('is the sign-in time in the access and ID tokens, and a refresh later keeps it', async () => {
      await start({ testUser: { sub: 'u' } });
      const before = Math.floor(Date.now() / 1000);
      const { body } = await signIn();
      const authTime = decode(body.access_token)['auth_time'] as number;

      expect(authTime).toBeGreaterThanOrEqual(before);
      expect(authTime).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000));
      expect(decode(body.id_token)['auth_time']).toBe(authTime);

      const later = Date.now() + 120_000;
      jest.spyOn(Date, 'now').mockReturnValue(later);
      const refreshed = await token({ grant_type: 'refresh_token', refresh_token: body.refresh_token });
      const payload = decode(refreshed.body.access_token);

      expect(payload['auth_time']).toBe(authTime);
      expect(payload['iat']).toBe(Math.floor(later / 1000));
    });
  });

  describe('resourceIndicators', () => {
    it('unset, ignores resource and audience as before, and warns once naming the option', async () => {
      await start({ testUser: { sub: 'u' } });

      const { body } = await signIn({ resource: NOTES, audience: 'notes-api' }, { resource: NOTES });
      await signIn({ resource: TASKS });

      expect(decode(body.access_token)['aud']).toBe('default-audience');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('resourceIndicators: true');
    });

    it('true, issues the token for the requested resource and audience, and a refresh keeps it', async () => {
      await start({ testUser: { sub: 'u' }, resourceIndicators: true });

      const { body } = await signIn({ resource: NOTES, audience: 'notes-api' });
      const refreshed = await token({ grant_type: 'refresh_token', refresh_token: body.refresh_token });

      expect(decode(body.access_token)['aud']).toEqual([NOTES, 'notes-api']);
      expect(decode(refreshed.body.access_token)['aud']).toEqual([NOTES, 'notes-api']);
      expect(warn).not.toHaveBeenCalled();
    });

    it('true, keeps the default audience when the request names none', async () => {
      await start({ testUser: { sub: 'u' }, resourceIndicators: true });
      const { body } = await signIn();
      expect(decode(body.access_token)['aud']).toBe('default-audience');
    });

    it('narrows the audience to the resource a token request names, and refuses one never granted', async () => {
      await start({ testUser: { sub: 'u' }, resourceIndicators: true });

      const narrowed = await signIn({ resource: [NOTES, TASKS] }, { resource: TASKS });
      const outside = await signIn({ resource: NOTES }, { resource: TASKS });
      const refreshOutside = await token({
        grant_type: 'refresh_token',
        refresh_token: narrowed.body.refresh_token,
        resource: 'https://other.example.com',
      });

      expect(decode(narrowed.body.access_token)['aud']).toBe(TASKS);
      expect(outside).toMatchObject({ status: 400, body: { error: 'invalid_target' } });
      expect(refreshOutside).toMatchObject({ status: 400, body: { error: 'invalid_target' } });
    });

    it('a list, accepts those values only, and redirects any other back with invalid_target', async () => {
      await start({ testUser: { sub: 'u' }, resourceIndicators: [NOTES] });

      const refused = await authorize({ resource: TASKS });
      const { body } = await signIn({ resource: NOTES });

      expect(refused.get('error')).toBe('invalid_target');
      expect(refused.get('code')).toBeNull();
      expect(refused.get('state')).toBe('s');
      expect(decode(body.access_token)['aud']).toBe(NOTES);
    });
  });

  describe('users', () => {
    const ada = { sub: 'ada', email: 'ada@example.com', name: 'Ada', claims: { roles: ['admin'] } };
    const bob = { sub: 'bob', email: 'bob@example.com', name: 'Bob', scopes: ['openid', 'notes:read'] };

    it('signs in the user a login_hint names, by sub or email, with that user in both tokens', async () => {
      await start({ users: [ada, bob] });

      const asBob = await signIn({ login_hint: 'bob@example.com' });
      const asAda = await signIn({ login_hint: 'ada' });

      expect(decode(asBob.body.access_token)).toMatchObject({ sub: 'bob', email: 'bob@example.com', name: 'Bob' });
      expect(decode(asAda.body.access_token)).toMatchObject({ sub: 'ada', roles: ['admin'] });
      expect(decode(asAda.body.id_token)).toMatchObject({ sub: 'ada', email: 'ada@example.com' });
    });

    it('without a hint, signs in testUser, else the first user', async () => {
      await start({ users: [ada, bob] });
      expect(decode((await signIn()).body.access_token)['sub']).toBe('ada');

      server.setTestUser(bob);
      expect(decode((await signIn()).body.access_token)['sub']).toBe('bob');
    });

    it('redirects a login_hint that names no user back with access_denied', async () => {
      await start({ users: [ada] });
      const redirect = await authorize({ login_hint: 'carol' });
      expect(redirect.get('error')).toBe('access_denied');
      expect(redirect.get('code')).toBeNull();
    });

    it("grants only the requested scopes in the user's scopes", async () => {
      await start({ users: [bob] });
      const { body } = await signIn({ scope: 'openid notes:read notes:write' });
      expect(body.scope).toBe('openid notes:read');
      expect(decode(body.access_token)['scope']).toBe('openid notes:read');
    });

    it('answers userinfo with the user the token names', async () => {
      await start({ users: [ada, bob] });
      const { body } = await signIn({ login_hint: 'bob' });
      const userinfo = (token: string) =>
        fetch(`${server.info.baseUrl}/userinfo`, { headers: { Authorization: `Bearer ${token}` } });

      expect(await (await userinfo(body.access_token)).json()).toMatchObject({ sub: 'bob', email: 'bob@example.com' });
      expect((await userinfo('not-a-jwt')).status).toBe(401);
    });

    it("signs in, from the manual form, the listed user with the form's user ID", async () => {
      await start({ users: [ada, bob], autoApprove: false });
      const page = await (
        await fetch(
          `${server.info.baseUrl}/oauth/authorize?client_id=c&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&login_hint=bob`,
        )
      ).text();
      expect(page).toContain('value="bob"');

      const form = new URLSearchParams({ client_id: 'c', redirect_uri: REDIRECT_URI, sub: 'ada', action: 'approve' });
      const submitted = await fetch(`${server.info.baseUrl}/oauth/authorize/submit`, {
        method: 'POST',
        body: form,
        redirect: 'manual',
      });
      const code = new URL(submitted.headers.get('location') as string).searchParams.get('code') as string;
      const { body } = await token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });

      expect(decode(body.access_token)).toMatchObject({ sub: 'ada', roles: ['admin'] });
    });

    it('without users, ignores login_hint and signs in testUser, as before', async () => {
      await start({ testUser: { sub: 'only' } });
      const { body } = await signIn({ login_hint: 'someone-else' });
      expect(decode(body.access_token)['sub']).toBe('only');
    });
  });
});
