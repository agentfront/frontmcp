/**
 * LocalPrimaryAuth — incremental-ticket replay guard (GHSA-2c4g-9c8x-6m8g).
 *
 * The ticket authorizes skipping the login step, and its `auth_url` travels
 * through agent transcripts and server logs, so it must be usable exactly once.
 *
 * The concurrency case is the one that matters: the guard is built lazily, so
 * two simultaneous claims must not each construct their own store — each would
 * then write and read back its own nonce and both would win, making the ticket
 * multi-use on the default (in-memory) deployment.
 */
import 'reflect-metadata';

import { LocalPrimaryAuth } from '../instance.local-primary-auth';

function createProviders() {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
  return {
    getActiveScope: () => ({
      logger,
      metadata: { http: { port: 3001 } },
      registryFlows: jest.fn().mockResolvedValue(undefined),
    }),
    injectProvider: jest.fn(),
    addDynamicProviders: jest.fn().mockResolvedValue(undefined),
  } as never;
}

async function makeAuth(): Promise<LocalPrimaryAuth> {
  const auth = new LocalPrimaryAuth({ fullPath: '' } as never, createProviders(), { mode: 'local' } as never);
  await auth.ready;
  return auth;
}

const TTL_MS = 300_000;

describe('LocalPrimaryAuth.claimIncrementalTicket', () => {
  it('claims an unused ticket', async () => {
    const auth = await makeAuth();

    await expect(auth.claimIncrementalTicket('jti-1', TTL_MS)).resolves.toBe(true);
  });

  it('refuses the same ticket a second time', async () => {
    const auth = await makeAuth();

    await expect(auth.claimIncrementalTicket('jti-2', TTL_MS)).resolves.toBe(true);
    await expect(auth.claimIncrementalTicket('jti-2', TTL_MS)).resolves.toBe(false);
  });

  it('keeps distinct tickets independent', async () => {
    const auth = await makeAuth();

    await expect(auth.claimIncrementalTicket('jti-a', TTL_MS)).resolves.toBe(true);
    await expect(auth.claimIncrementalTicket('jti-b', TTL_MS)).resolves.toBe(true);
  });

  it('lets exactly ONE of two concurrent claims win', async () => {
    // The guard is built lazily on first use. Both calls below race that
    // construction, which is precisely when a per-call store would hand each
    // caller its own nonce and let both through.
    const auth = await makeAuth();

    const results = await Promise.all([
      auth.claimIncrementalTicket('jti-race', TTL_MS),
      auth.claimIncrementalTicket('jti-race', TTL_MS),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('lets exactly ONE of many concurrent claims win', async () => {
    const auth = await makeAuth();

    const results = await Promise.all(
      Array.from({ length: 16 }, () => auth.claimIncrementalTicket('jti-stampede', TTL_MS)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('fails CLOSED when the replay guard cannot be written to', async () => {
    // A transient storage failure must not downgrade the ticket to multi-use.
    const auth = await makeAuth();
    (auth as unknown as { ticketReplayStorage: Promise<unknown> }).ticketReplayStorage = Promise.resolve({
      set: async () => {
        throw new Error('redis down');
      },
      get: async () => null,
    });

    await expect(auth.claimIncrementalTicket('jti-down', TTL_MS)).resolves.toBe(false);
  });

  it('falls back to an in-memory guard when the backend has no conditional write', async () => {
    // Cloudflare KV raises StorageNotSupportedError for a conditional set.
    // Rejecting every ticket there would disable incremental auth silently, so
    // the guard degrades to per-instance single use instead.
    const { StorageNotSupportedError } = await import('@frontmcp/utils');
    const auth = await makeAuth();
    (auth as unknown as { ticketReplayStorage: Promise<unknown> }).ticketReplayStorage = Promise.resolve({
      set: async () => {
        throw new StorageNotSupportedError('conditional set (ifNotExists/ifExists)', 'cloudflare-kv');
      },
      get: async () => null,
    });

    await expect(auth.claimIncrementalTicket('jti-kv', TTL_MS)).resolves.toBe(true);
    await expect(auth.claimIncrementalTicket('jti-kv', TTL_MS)).resolves.toBe(false);
  });
});
