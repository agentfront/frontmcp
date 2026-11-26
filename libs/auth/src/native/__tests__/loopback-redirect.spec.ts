/**
 * The loopback redirect listener, on a stand-in for `node:http`'s server: no real port is bound, so a busy port is
 * whatever the test says it is.
 */
import { EventEmitter } from 'node:events';

import { listenForRedirect, type LoopbackRedirectOptions } from '../loopback-redirect';

/** Binds like a Node server: `listen` registers its callback on `listening`, and a busy port emits `error`. */
class StandInServer extends EventEmitter {
  port?: number;
  readonly attempts: number[] = [];

  constructor(readonly busy: (port: number) => boolean) {
    super();
  }

  listen(port: number, _host: string, callback?: () => void): this {
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

  it('takes any free port by default', async () => {
    mockServer = new StandInServer(() => false);

    const redirect = await listenForRedirect(OPTIONS);

    expect(redirect.redirectUri).toBe('http://127.0.0.1:49152/callback');
    redirect.close();
  });
});
