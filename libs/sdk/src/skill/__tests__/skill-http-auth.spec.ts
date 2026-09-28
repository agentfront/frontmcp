import 'reflect-metadata';

import type { ScopeEntry, ServerRequest } from '../../common';
import type { SkillsConfigOptions } from '../../common/types/options/skills-http';
import { authorizeSkillHttpRequest, createSkillHttpAuthValidator, SkillHttpAuthValidator } from '../auth';

function requestWith(headers: Record<string, string> = {}): ServerRequest {
  return { headers, method: 'GET', path: '/llm.txt', query: {} } as unknown as ServerRequest;
}

function scopeWith(
  mode: string | undefined,
  verify: () => Promise<unknown> = async () => undefined,
): ScopeEntry & { runFlow: jest.Mock } {
  return {
    auth: mode ? { options: { mode } } : undefined,
    runFlow: jest.fn(verify),
  } as unknown as ScopeEntry & { runFlow: jest.Mock };
}

describe('createSkillHttpAuthValidator', () => {
  it('needs no validator only for auth "public"', () => {
    expect(createSkillHttpAuthValidator({ auth: 'public' } as SkillsConfigOptions)).toBeNull();
    expect(createSkillHttpAuthValidator({ auth: 'inherit' } as SkillsConfigOptions)).toBeInstanceOf(
      SkillHttpAuthValidator,
    );
    expect(createSkillHttpAuthValidator(undefined)).toBeInstanceOf(SkillHttpAuthValidator);
  });

  it.each(['inherit', 'something-else'])('refuses every request for auth %s', async (auth) => {
    const validator = new SkillHttpAuthValidator({ skillsConfig: { auth } as unknown as SkillsConfigOptions });

    await expect(validator.validate({ headers: {} })).resolves.toEqual({
      authorized: false,
      error: 'Server misconfiguration',
      statusCode: 500,
    });
  });
});

describe('authorizeSkillHttpRequest', () => {
  describe('auth "inherit"', () => {
    it('lets everyone in on a public server, without running the server auth', async () => {
      const scope = scopeWith('public');

      await expect(
        authorizeSkillHttpRequest(scope, { auth: 'inherit' } as SkillsConfigOptions, requestWith()),
      ).resolves.toEqual({ allowed: true, authInfo: {} });
      expect(scope.runFlow).not.toHaveBeenCalled();
    });

    it('evaluates skills against the caller the server auth verified', async () => {
      const user = { sub: 'ada', iss: 'idp', roles: ['admin'] };
      const scope = scopeWith('transparent', async () => ({ kind: 'authorized', authorization: { token: 't', user } }));

      const access = await authorizeSkillHttpRequest(scope, undefined, requestWith());

      expect(access).toMatchObject({ allowed: true, authInfo: { user, clientId: 'ada' } });
      expect(scope.runFlow).toHaveBeenCalledWith('session:verify', { request: expect.anything(), sessionless: true });
    });

    it.each([
      ['unauthorized', 401, 'Authentication required'],
      ['forbidden', 403, 'Insufficient scope'],
    ])('answers %s with %d and the challenge', async (kind, status, error) => {
      const scope = scopeWith('transparent', async () => ({ kind, prmMetadataHeader: 'Bearer realm="x"' }));

      await expect(authorizeSkillHttpRequest(scope, undefined, requestWith())).resolves.toEqual({
        allowed: false,
        status,
        error,
        headers: { 'WWW-Authenticate': 'Bearer realm="x"' },
      });
    });

    it('refuses when the server auth gives no answer', async () => {
      await expect(authorizeSkillHttpRequest(scopeWith('static'), undefined, requestWith())).resolves.toEqual({
        allowed: false,
        status: 401,
        error: 'Authentication required',
        headers: undefined,
      });
    });
  });

  describe('auth "api-key"', () => {
    const skillsConfig = { auth: 'api-key', apiKeys: ['k-1'] } as SkillsConfigOptions;

    it('lets in a request with a configured key, as an anonymous caller', async () => {
      await expect(
        authorizeSkillHttpRequest(scopeWith('static'), skillsConfig, requestWith({ 'x-api-key': 'k-1' })),
      ).resolves.toEqual({ allowed: true, authInfo: {} });
    });

    it('refuses a request without one', async () => {
      await expect(authorizeSkillHttpRequest(scopeWith('static'), skillsConfig, requestWith())).resolves.toEqual({
        allowed: false,
        status: 401,
        error: 'Invalid or missing API key',
      });
    });
  });

  it('lets everyone in for auth "public"', async () => {
    const scope = scopeWith('static');

    await expect(
      authorizeSkillHttpRequest(scope, { auth: 'public' } as SkillsConfigOptions, requestWith()),
    ).resolves.toEqual({
      allowed: true,
      authInfo: {},
    });
    expect(scope.runFlow).not.toHaveBeenCalled();
  });
});
