/**
 * The loopback redirect listener, on a stand-in for `node:http`'s server: no real port is bound, so a busy port is
 * whatever the test says it is.
 */
import { EventEmitter } from 'node:events';

import { listenForRedirect, type LoopbackRedirectOptions } from '../loopback-redirect';
import { NativeSignInError } from '../native-sign-in.error';

/** Binds like a Node server: `listen` registers its callback on `listening`, and a busy port emits `error`. */
class StandInServer extends EventEmitter {
  port?: number;
  readonly attempts: number[] = [];
  calls = 0;

  constructor(readonly busy: (port: number) => boolean) {
    super();
  }

  listen(port: number, _host: string, callback?: () => void): this {
    // A caller that keeps binding forever waits here instead, so its test times out rather than hangs the worker.
    if (++this.calls > 1_000) return this;
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new RangeError(`options.port should be >= 0 and < 65536. Received ${port}.`);
    }
    this.attempts.push(port);
    if (callback) this.once('listening', callback);
    setImmediate(() => {
      if (this.busy(port)) {
        this.emit('error', Object.assign(new Error(`listen EADDRINUSE: 127.0.0.1:${port}`), { code: 'EADDRINUSE' }));
      } else {
        this.port = port === 0 ? 49_152 : port;
        this.emit('listening');
      }
    });
    return this;
  }

  address(): { port: number } | null {
    return this.port === undefined ? null : { port: this.port };
  }

  close(): this {
    return this;
  }

  closeAllConnections(): void {
    // nothing is connected to a stand-in
  }
}

let mockServer: StandInServer;
jest.mock('node:http', () => ({ createServer: () => mockServer }));

const OPTIONS: LoopbackRedirectOptions = {
  path: '/callback',
  timeoutMs: 60_000,
  state: 'state-1',
  issuer: 'https://auth.example.com',
  issRequired: false,
};

describe('listenForRedirect', () => {
  it('takes the first free port of a range', async () => {
    mockServer = new StandInServer((port) => port === 40_000);

    const redirect = await listenForRedirect({ ...OPTIONS, port: [40_000, 40_001], path: '/cb' });

    expect(redirect.redirectUri).toBe('http://127.0.0.1:40001/cb');
    expect(mockServer.attempts).toEqual([40_000, 40_001]);
    redirect.close();
  });

  it.each([
    ['a port above 65535', 65_536],
    ['a negative port', -1],
    ['a fractional port', 3000.5],
    ['a range past 65535', [65_536, Infinity] as const],
    ['a range that ends before it starts', [3001, 3000] as const],
    ['a range with a fractional end', [3000, 3000.5] as const],
    ['a range that holds port 0', [0, 10] as const],
  ])(
    'refuses %s before it binds',
    async (_case, port) => {
      mockServer = new StandInServer(() => false);

      const error = await listenForRedirect({ ...OPTIONS, port }).then(
        () => undefined,
        (reason: unknown) => reason,
      );

      expect(error).toBeInstanceOf(NativeSignInError);
      expect(error).toMatchObject({ code: 'invalid_port' });
      expect(mockServer.calls).toBe(0);
    },
    2_000,
  );

  it('leaves no bind handler behind when every port of a range is busy', async () => {
    mockServer = new StandInServer(() => true);
    const warnings = jest.spyOn(process, 'emitWarning').mockImplementation(() => undefined);

    const error = await listenForRedirect({ ...OPTIONS, port: [41_000, 41_011] }).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(error).toMatchObject({ code: 'port_unavailable' });
    expect(mockServer.listenerCount('listening')).toBe(0);
    expect(mockServer.listenerCount('error')).toBe(0);
    expect(warnings).not.toHaveBeenCalled();
    warnings.mockRestore();
  });

  it('answers 400 to a request whose target is not a URL, and still takes the callback', async () => {
    mockServer = new StandInServer(() => false);
    const redirect = await listenForRedirect(OPTIONS);
    const respond = (url: string) => {
      const res = { status: 0, writeHead: jest.fn(), end: jest.fn((_body?: string, done?: () => void) => done?.()) };
      res.writeHead.mockImplementation((status: number) => ((res.status = status), res));
      mockServer.emit('request', { url }, res);
      return res.status;
    };

    expect(respond('//')).toBe(400);
    expect(respond('/callback?state=state-1&code=the-code')).toBe(200);
    await expect(redirect.code).resolves.toBe('the-code');
  });

  it('takes any free port by default', async () => {
    mockServer = new StandInServer(() => false);

    const redirect = await listenForRedirect(OPTIONS);

    expect(redirect.redirectUri).toBe('http://127.0.0.1:49152/callback');
    redirect.close();
  });
});
