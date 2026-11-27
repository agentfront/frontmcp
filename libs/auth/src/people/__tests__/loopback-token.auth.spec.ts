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

  it('keeps store: false, which keeps sessions in memory', () => {
    expect(peopleAuthOptionsSchema().parse({ mode: 'loopback-token', store: false })).toEqual({
      ...DEFAULTS,
      store: false,
    });
  });

  it.each([
    ['a store that is not false', { mode: 'loopback-token', store: true }],
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

    it('track at most 1024 clients, however many fail within lockoutMs', () => {
      for (let client = 0; client < 3000; client++) auth.exchangeCode('wrong', `client-${client}`);

      expect((auth as unknown as { failures: Map<string, unknown> }).failures.size).toBeLessThanOrEqual(1024);
      for (let attempt = 0; attempt < 4; attempt++) auth.exchangeCode('wrong', 'client-2999');
      const { code } = auth.createCode();
      expect(auth.exchangeCode(code, 'client-2999')).toEqual({ ok: false, reason: 'locked' });
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

  describe('a code made for a subject', () => {
    function signedInFor(subject: string): string {
      const { code } = auth.createCode({ subject });
      const result = auth.exchangeCode(code, 'client-a');
      if (!result.ok) throw new Error('the code was refused');
      return result.cookieValue;
    }

    it('signs the person in for that subject', () => {
      const cookieValue = signedInFor('principal:alice');

      expect(auth.verifySession(cookieValue)).toEqual({
        expiresAt: 1_000_000 + 43_200_000,
        subject: 'principal:alice',
      });
    });

    it('keeps the subjects of two sessions apart', () => {
      const alice = signedInFor('principal:alice');
      const bob = signedInFor('principal:bob');

      expect([auth.verifySession(alice)?.subject, auth.verifySession(bob)?.subject]).toEqual([
        'principal:alice',
        'principal:bob',
      ]);
    });

    it('gives a session signed in with the token no subject', () => {
      const issued = auth.exchangeToken(auth.takeToken(), 'client-a');
      if (!issued.ok) throw new Error('the token was refused');
      const session = auth.exchangeCode(issued.code, 'client-a');
      if (!session.ok) throw new Error('the code was refused');

      expect(auth.verifySession(session.cookieValue)).toEqual({ expiresAt: 1_000_000 + 43_200_000 });
    });
  });
});

function mapStore() {
  const entries = new Map<string, { value: string; ttlSeconds?: number }>();
  return {
    entries,
    get: jest.fn(async (key: string) => entries.get(key)?.value ?? null),
    set: jest.fn(async (key: string, value: string, options?: { ttlSeconds?: number }) => {
      entries.set(key, { value, ttlSeconds: options?.ttlSeconds });
    }),
    delete: jest.fn(async (key: string) => entries.delete(key)),
  };
}

describe('LoopbackTokenAuth with a session store (#1355)', () => {
  let store: ReturnType<typeof mapStore>;
  let auth: LoopbackTokenAuth;

  beforeEach(() => {
    jest.useFakeTimers({ now: 1_000_000 });
    store = mapStore();
    auth = new LoopbackTokenAuth(DEFAULTS, { store });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function keptSignIn(subject?: string): Promise<string> {
    const { code } = auth.createCode(subject ? { subject } : {});
    const result = auth.exchangeCode(code, 'client-a');
    if (!result.ok) throw new Error('the code was refused');
    await auth.flush();
    return result.cookieValue;
  }

  it('lets the next process on the same store find the session, so a restart signs no one out', async () => {
    const cookieValue = await keptSignIn();
    const restarted = new LoopbackTokenAuth(DEFAULTS, { store });

    expect(restarted.verifySession(cookieValue)).toBeUndefined();
    expect(await restarted.findSession(cookieValue)).toEqual({ expiresAt: 1_000_000 + 43_200_000 });
  });

  it('keeps the subject a session was signed in for', async () => {
    const cookieValue = await keptSignIn('principal:alice');

    expect(await new LoopbackTokenAuth(DEFAULTS, { store }).findSession(cookieValue)).toEqual({
      expiresAt: 1_000_000 + 43_200_000,
      subject: 'principal:alice',
    });
  });

  it('keeps a digest of the cookie value, never the value, for as long as the session lasts', async () => {
    const cookieValue = await keptSignIn();

    const [[key, entry]] = [...store.entries];
    expect(key).toMatch(/^session:[A-Za-z0-9_-]{43}$/);
    expect(`${key} ${entry.value}`).not.toContain(cookieValue);
    expect(entry.ttlSeconds).toBe(43_200);
  });

  it('ends the kept session when the person signs out', async () => {
    const cookieValue = await keptSignIn();

    auth.endSession(cookieValue);
    await auth.flush();

    expect(store.entries.size).toBe(0);
    expect(await new LoopbackTokenAuth(DEFAULTS, { store }).findSession(cookieValue)).toBeUndefined();
  });

  describe('a sign-out the store cannot remove at once', () => {
    it('refuses the session here while the store still holds it, and says so', async () => {
      const onError = jest.fn();
      auth = new LoopbackTokenAuth(DEFAULTS, { store, onError });
      const cookieValue = await keptSignIn();
      store.delete.mockRejectedValueOnce(new Error('store down'));

      auth.endSession(cookieValue);
      await auth.flush();

      expect(store.entries.size).toBe(1);
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('could not be removed'), expect.any(Error));
      expect(await auth.findSession(cookieValue)).toBeUndefined();
    });

    it('refuses the session while the removal is still on its way to the store', async () => {
      const cookieValue = await keptSignIn();
      let finish: () => void = () => undefined;
      store.delete.mockImplementationOnce(
        (key: string) => new Promise<boolean>((resolve) => (finish = () => resolve(store.entries.delete(key)))),
      );

      auth.endSession(cookieValue);

      expect(await auth.findSession(cookieValue)).toBeUndefined();
      finish();
      await auth.flush();
      expect(store.entries.size).toBe(0);
    });

    it('refuses a session another process made, as signed out here', async () => {
      const cookieValue = await keptSignIn();
      const other = new LoopbackTokenAuth(DEFAULTS, { store });
      store.delete.mockRejectedValueOnce(new Error('store down'));

      other.endSession(cookieValue);
      await other.flush();

      expect(store.entries.size).toBe(1);
      expect(await other.findSession(cookieValue)).toBeUndefined();
    });

    it('tries the removal again when the cookie comes back', async () => {
      const cookieValue = await keptSignIn();
      store.delete.mockRejectedValueOnce(new Error('store down'));
      auth.endSession(cookieValue);
      await auth.flush();

      expect(await auth.findSession(cookieValue)).toBeUndefined();
      await auth.flush();

      expect(store.delete).toHaveBeenCalledTimes(2);
      expect(store.entries.size).toBe(0);
    });

    it('tries the removal again at the next flush, such as the next sign-in or shutdown', async () => {
      const cookieValue = await keptSignIn();
      store.delete.mockRejectedValueOnce(new Error('store down'));
      auth.endSession(cookieValue);
      await auth.flush();

      await auth.flush();

      expect(store.delete).toHaveBeenCalledTimes(2);
      expect(store.entries.size).toBe(0);
      expect(await new LoopbackTokenAuth(DEFAULTS, { store }).findSession(cookieValue)).toBeUndefined();
    });

    it('stops trying once the session would have expired, when the store has dropped it anyway', async () => {
      const cookieValue = await keptSignIn();
      store.delete.mockRejectedValueOnce(new Error('store down'));
      auth.endSession(cookieValue);
      await auth.flush();

      jest.advanceTimersByTime(43_200_001);
      await auth.flush();

      expect(store.delete).toHaveBeenCalledTimes(1);
    });

    it('leaves the other sessions signed in', async () => {
      const leaving = await keptSignIn();
      const staying = await keptSignIn();
      store.delete.mockRejectedValueOnce(new Error('store down'));

      auth.endSession(leaving);
      await auth.flush();

      expect(await auth.findSession(staying)).toEqual({ expiresAt: 1_000_000 + 43_200_000 });
      expect(await new LoopbackTokenAuth(DEFAULTS, { store }).findSession(staying)).toEqual({
        expiresAt: 1_000_000 + 43_200_000,
      });
    });
  });

  describe('a session this process made, on a store other processes share', () => {
    it('ends here once another process on the store signs it out', async () => {
      const cookieValue = await keptSignIn();
      const other = new LoopbackTokenAuth(DEFAULTS, { store });

      other.endSession(cookieValue);
      await other.flush();

      expect(await auth.findSession(cookieValue)).toBeUndefined();
      expect(auth.verifySession(cookieValue)).toBeUndefined();
    });

    it('stays signed in while the store cannot be read, and says so', async () => {
      const onError = jest.fn();
      auth = new LoopbackTokenAuth(DEFAULTS, { store, onError });
      const cookieValue = await keptSignIn();
      store.get.mockRejectedValueOnce(new Error('store down'));

      expect(await auth.findSession(cookieValue)).toEqual({ expiresAt: 1_000_000 + 43_200_000 });
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('could not be read'), expect.any(Error));
    });

    /** Holds the next store read until the test answers it: with what the store held when it was made, or an error. */
    function holdNextRead(): { answer: () => void; fail: () => void } {
      const held = { answer: () => undefined, fail: () => undefined } as { answer: () => void; fail: () => void };
      store.get.mockImplementationOnce(
        (key: string) =>
          new Promise<string | null>((resolve, reject) => {
            const value = store.entries.get(key)?.value ?? null;
            held.answer = () => resolve(value);
            held.fail = () => reject(new Error('store down'));
          }),
      );
      return held;
    }

    it('refuses a session signed out here while the store was read, though the read then fails', async () => {
      const cookieValue = await keptSignIn();
      const read = holdNextRead();

      const finding = auth.findSession(cookieValue);
      auth.endSession(cookieValue);
      read.fail();

      expect(await finding).toBeUndefined();
    });

    it('refuses a session signed out and removed here while the store answered with what it held before', async () => {
      const cookieValue = await keptSignIn();
      const read = holdNextRead();

      const finding = auth.findSession(cookieValue);
      auth.endSession(cookieValue);
      await auth.flush();
      read.answer();

      expect(await finding).toBeUndefined();
    });

    it('refuses a session that expired while the store was read, though the read then fails', async () => {
      const cookieValue = await keptSignIn();
      const read = holdNextRead();

      const finding = auth.findSession(cookieValue);
      jest.setSystemTime(1_000_000 + 43_200_000);
      read.fail();

      expect(await finding).toBeUndefined();
    });

    it('stays signed in when the store could not keep it, as it lives only here', async () => {
      store.set.mockRejectedValueOnce(new Error('store down'));
      const cookieValue = await keptSignIn();

      expect(await auth.findSession(cookieValue)).toEqual({ expiresAt: 1_000_000 + 43_200_000 });
    });
  });

  it('finds no kept session once it has expired', async () => {
    const cookieValue = await keptSignIn();

    jest.advanceTimersByTime(43_200_001);

    expect(await new LoopbackTokenAuth(DEFAULTS, { store }).findSession(cookieValue)).toBeUndefined();
  });

  it.each([
    ['that is not JSON', 'not json'],
    ['whose expiry is not a number', JSON.stringify({ expiresAt: 'later' })],
    ['whose subject is not a string', JSON.stringify({ expiresAt: 2_000_000_000_000, subject: 7 })],
  ])('finds no session from a kept record %s', async (_case, value) => {
    const cookieValue = await keptSignIn();
    for (const entry of store.entries.values()) entry.value = value;

    expect(await new LoopbackTokenAuth(DEFAULTS, { store }).findSession(cookieValue)).toBeUndefined();
  });

  it('waits in flush() for the session to be kept', async () => {
    let finish: () => void = () => undefined;
    store.set.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    const { code } = auth.createCode();
    auth.exchangeCode(code, 'client-a');
    let flushed = false;

    const flushing = auth.flush().then(() => (flushed = true));
    await Promise.resolve();
    expect(flushed).toBe(false);
    finish();
    await flushing;

    expect(flushed).toBe(true);
  });

  it('still signs the person in when the store cannot keep the session, and says so', async () => {
    const onError = jest.fn();
    store.set.mockRejectedValueOnce(new Error('store down'));
    auth = new LoopbackTokenAuth(DEFAULTS, { store, onError });

    const cookieValue = await keptSignIn();

    expect(auth.verifySession(cookieValue)).toEqual({ expiresAt: 1_000_000 + 43_200_000 });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('could not be kept'), expect.any(Error));
  });

  it('finds no session when the store cannot be read, and says so', async () => {
    const onError = jest.fn();
    store.get.mockRejectedValueOnce(new Error('store down'));

    const found = await new LoopbackTokenAuth(DEFAULTS, { store, onError }).findSession('a-cookie-value');

    expect(found).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('could not be read'), expect.any(Error));
  });

  it('without a store, finds only the sessions this process made', async () => {
    const memoryOnly = new LoopbackTokenAuth(DEFAULTS);
    const { code } = memoryOnly.createCode();
    const result = memoryOnly.exchangeCode(code, 'client-a');
    if (!result.ok) throw new Error('the code was refused');

    expect(await memoryOnly.findSession(result.cookieValue)).toEqual({ expiresAt: 1_000_000 + 43_200_000 });
    expect(await new LoopbackTokenAuth(DEFAULTS).findSession(result.cookieValue)).toBeUndefined();
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
