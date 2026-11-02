import * as utils from '@frontmcp/utils';

import {
  LoopbackTokenAuth,
  PEOPLE_SESSION_COOKIE,
  peopleAuthOptionsSchema,
  peopleSessionCookie,
  type PeopleAuthOptions,
} from '../index';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual<typeof import('@frontmcp/utils')>('@frontmcp/utils');
  return { ...actual, timingSafeEqual: jest.fn(actual.timingSafeEqual) };
});

const DEFAULTS: PeopleAuthOptions = {
  mode: 'loopback-token',
  codeTtlMs: 60_000,
  sessionTtlMs: 43_200_000,
  maxFailedAttempts: 5,
  lockoutMs: 60_000,
  cookiePath: '/',
};

function signedIn(auth: LoopbackTokenAuth, client = 'client-a'): string {
  const { code } = auth.createCode();
  const result = auth.exchangeCode(code, client);
  if (!result.ok) throw new Error('the code was refused');
  return result.cookieValue;
}

describe('peopleAuthOptionsSchema', () => {
  it("expands 'loopback-token' to the defaults", () => {
    expect(peopleAuthOptionsSchema().parse('loopback-token')).toEqual(DEFAULTS);
  });

  it('keeps the settings an object gives and fills in the rest', () => {
    expect(peopleAuthOptionsSchema().parse({ mode: 'loopback-token', codeTtlMs: 30_000, cookiePath: '/app' })).toEqual({
      ...DEFAULTS,
      codeTtlMs: 30_000,
      cookiePath: '/app',
    });
  });

  it.each([
    ['an unknown mode', 'oidc'],
    ['an unknown setting', { mode: 'loopback-token', ttl: 5 }],
    ['a code that lives longer than 10 minutes', { mode: 'loopback-token', codeTtlMs: 600_001 }],
    ['a session TTL of zero', { mode: 'loopback-token', sessionTtlMs: 0 }],
    ['a cookie path that is not absolute', { mode: 'loopback-token', cookiePath: 'app' }],
  ])('refuses %s', (_case, value) => {
    expect(peopleAuthOptionsSchema().safeParse(value).success).toBe(false);
  });
});

describe('LoopbackTokenAuth', () => {
  let auth: LoopbackTokenAuth;

  beforeEach(() => {
    jest.useFakeTimers({ now: 1_000_000 });
    auth = new LoopbackTokenAuth(DEFAULTS);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('the token', () => {
    it('is handed out once, for the startup print', () => {
      const token = auth.takeToken();

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(auth.takeToken()).toBeUndefined();
    });

    it('is different for every server', () => {
      expect(new LoopbackTokenAuth(DEFAULTS).takeToken()).not.toBe(auth.takeToken());
    });

    it('buys a one-time code', () => {
      const token = auth.takeToken();

      expect(auth.exchangeToken(token, 'client-a')).toEqual({
        ok: true,
        code: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        expiresAt: 1_060_000,
      });
    });

    it.each([
      ['a wrong token', 'not-the-token'],
      ['no token', undefined],
    ])('refuses %s', (_case, presented) => {
      expect(auth.exchangeToken(presented, 'client-a')).toEqual({ ok: false, reason: 'invalid' });
    });
  });

  describe('a sign-in code', () => {
    it('signs a person in once', () => {
      const { code } = auth.createCode();

      expect(auth.exchangeCode(code, 'client-a')).toEqual({
        ok: true,
        cookieValue: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        expiresAt: 1_000_000 + 43_200_000,
      });
      expect(auth.exchangeCode(code, 'client-a')).toEqual({ ok: false, reason: 'invalid' });
    });

    it('expires after codeTtlMs', () => {
      const { code } = auth.createCode();

      jest.advanceTimersByTime(60_001);

      expect(auth.exchangeCode(code, 'client-a')).toEqual({ ok: false, reason: 'invalid' });
    });

    it('is compared in constant time', () => {
      const { code } = auth.createCode();
      jest.mocked(utils.timingSafeEqual).mockClear();

      auth.exchangeCode(`${code}x`, 'client-a');

      expect(utils.timingSafeEqual).toHaveBeenCalled();
      for (const [left, right] of jest.mocked(utils.timingSafeEqual).mock.calls) {
        expect(left.length).toBe(right.length);
      }
    });
  });

  describe('bad codes', () => {
    it('lock a client out after maxFailedAttempts, even from a good code', () => {
      for (let attempt = 1; attempt < 5; attempt++) {
        expect(auth.exchangeCode(`wrong-${attempt}`, 'client-a')).toEqual({ ok: false, reason: 'invalid' });
      }
      expect(auth.exchangeCode('wrong-5', 'client-a')).toEqual({ ok: false, reason: 'locked' });

      const { code } = auth.createCode();
      expect(auth.exchangeCode(code, 'client-a')).toEqual({ ok: false, reason: 'locked' });
    });

    it('lock out the bad tokens of a client too', () => {
      for (let attempt = 0; attempt < 5; attempt++) auth.exchangeToken('wrong', 'client-a');

      expect(auth.exchangeToken(auth.takeToken(), 'client-a')).toEqual({ ok: false, reason: 'locked' });
    });

    it('lock out only the client that sent them', () => {
      for (let attempt = 0; attempt < 5; attempt++) auth.exchangeCode('wrong', 'client-a');

      const { code } = auth.createCode();
      expect(auth.exchangeCode(code, 'client-b').ok).toBe(true);
    });

    it('end their lockout after lockoutMs', () => {
      for (let attempt = 0; attempt < 5; attempt++) auth.exchangeCode('wrong', 'client-a');

      jest.advanceTimersByTime(60_001);

      const { code } = auth.createCode();
      expect(auth.exchangeCode(code, 'client-a').ok).toBe(true);
    });

    it('keep a locked client locked while idle clients are forgotten', () => {
      for (let client = 0; client < 1100; client++) auth.exchangeCode('wrong', `client-${client}`);
      jest.advanceTimersByTime(60_001);
      for (let attempt = 0; attempt < 5; attempt++) auth.exchangeCode('wrong', 'locked-client');

      auth.exchangeCode('wrong', 'new-client');

      const { code } = auth.createCode();
      expect(auth.exchangeCode(code, 'locked-client')).toEqual({ ok: false, reason: 'locked' });
    });

    it('are forgotten once lockoutMs passes without another', () => {
      for (let attempt = 0; attempt < 4; attempt++) auth.exchangeCode('wrong', 'client-a');

      jest.advanceTimersByTime(60_001);

      expect(auth.exchangeCode('wrong', 'client-a')).toEqual({ ok: false, reason: 'invalid' });
    });
  });

  describe('a session', () => {
    it('is recognised from its cookie value', () => {
      const cookieValue = signedIn(auth);

      expect(auth.verifySession(cookieValue)).toEqual({ expiresAt: 1_000_000 + 43_200_000 });
    });

    it('never has the token or the code as its cookie value', () => {
      const token = auth.takeToken();
      const issued = auth.exchangeToken(token, 'client-a');
      if (!issued.ok) throw new Error('the token was refused');
      const session = auth.exchangeCode(issued.code, 'client-a');

      expect(session.ok && [session.cookieValue === token, session.cookieValue === issued.code]).toEqual([
        false,
        false,
      ]);
    });

    it('ends after sessionTtlMs', () => {
      const cookieValue = signedIn(auth);

      jest.advanceTimersByTime(43_200_001);

      expect(auth.verifySession(cookieValue)).toBeUndefined();
    });

    it.each([
      ['an unknown value', 'not-a-session'],
      ['an empty value', ''],
      ['no value', undefined],
    ])('is not found from %s', (_case, presented) => {
      signedIn(auth);

      expect(auth.verifySession(presented)).toBeUndefined();
    });

    it('ends when the person signs out', () => {
      const cookieValue = signedIn(auth);

      auth.endSession(cookieValue);

      expect(auth.verifySession(cookieValue)).toBeUndefined();
    });
  });
});

describe('peopleSessionCookie', () => {
  it('is HttpOnly, SameSite=Strict and scoped to its path', () => {
    expect(peopleSessionCookie('value', { path: '/app', secure: false, maxAgeMs: 90_500 })).toEqual({
      name: PEOPLE_SESSION_COOKIE,
      value: 'value',
      path: '/app',
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
      maxAge: 90,
    });
  });

  it('is Secure over https', () => {
    expect(peopleSessionCookie('value', { path: '/', secure: true, maxAgeMs: 1000 }).secure).toBe(true);
  });
});
