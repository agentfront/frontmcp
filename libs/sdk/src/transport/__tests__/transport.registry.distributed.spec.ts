/**
 * TransportService in a distributed deployment (#680): a session another live node owns
 * is relayed to it, a session whose owner stopped is taken over, and a session the
 * orphan scanner claimed is re-advertised so every node routes it to its new owner.
 */
import { sha256Hex } from '@frontmcp/utils';

import type { ServerRequest, ServerResponse } from '../../common';
import { ServerRequestTokens } from '../../common/tokens/server.tokens';
import { InvalidTransportSessionError, SessionClaimConflictError } from '../../errors/transport.errors';
import { TransportService } from '../transport.registry';
import { RemoteTransporter } from '../transport.remote';
import type { RemoteLocation, TransportBus } from '../transport.types';

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  getMachineId: jest.fn(() => 'node-local'),
}));

jest.mock('../transport.local', () => ({
  LocalTransporter: jest.fn().mockImplementation((_scope, key, _res, onDispose) => ({
    type: key.type,
    sessionId: key.sessionId,
    ready: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockImplementation(async () => {
      if (onDispose) onDispose();
    }),
    markAsInitialized: jest.fn(),
  })),
}));

const mockStore = {
  ping: jest.fn().mockResolvedValue(true),
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn(),
  disconnect: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../auth/session/session-store.factory', () => ({
  createSessionStore: jest.fn(async () => mockStore),
}));

jest.mock('../flows/handle.streamable-http.flow', () => ({}));
jest.mock('../flows/handle.sse.flow', () => ({}));
jest.mock('../flows/handle.stateless-http.flow', () => ({}));
jest.mock('../flows/handle.mcp-20260728.flow', () => ({}));

const TOKEN = 'tok';
const TOKEN_HASH = sha256Hex(TOKEN);

function createLogger() {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), verbose: jest.fn(), debug: jest.fn() };
  return { ...logger, child: jest.fn(() => logger) };
}

function createScope(haManager?: Record<string, jest.Mock>) {
  return {
    logger: createLogger(),
    registryFlows: jest.fn().mockResolvedValue(undefined),
    notifications: { setClientCapabilities: jest.fn(), registerServer: jest.fn() },
    haManager,
  };
}

function createHaManager(alive: Record<string, boolean> = {}) {
  return {
    isNodeAlive: jest.fn(async (nodeId: string) => alive[nodeId] ?? false),
    attemptTakeover: jest.fn().mockResolvedValue({ claimed: true }),
  };
}

function createBus(overrides: Partial<Record<keyof TransportBus, jest.Mock>> = {}) {
  return {
    nodeId: jest.fn(() => 'node-local'),
    advertise: jest.fn().mockResolvedValue(undefined),
    revoke: jest.fn().mockResolvedValue(undefined),
    lookup: jest.fn().mockResolvedValue(null),
    lookupOwner: jest.fn().mockResolvedValue(null),
    channelOf: jest.fn((nodeId: string) => `mcp:ha:notify:${nodeId}`),
    canRelay: jest.fn(() => true),
    proxyRequest: jest.fn().mockResolvedValue(undefined),
    destroyRemote: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function storedSession(nodeId: string | undefined, protocol: 'streamable-http' | 'sse' = 'streamable-http') {
  return {
    session: { id: 'sess-1', authorizationId: TOKEN_HASH, protocol, createdAt: 1, nodeId },
    authorizationId: TOKEN_HASH,
    createdAt: 1,
    lastAccessedAt: 1,
    initialized: true,
  };
}

function request(headers: Record<string, string> = { 'mcp-session-id': 'sess-1' }, extra = {}): ServerRequest {
  return { headers, query: {}, ...extra } as unknown as ServerRequest;
}

const response = { setHeader: jest.fn() } as unknown as ServerResponse;

describe('TransportService — distributed sessions (#680)', () => {
  let service: TransportService | undefined;

  async function createService(options: {
    haManager?: ReturnType<typeof createHaManager>;
    bus?: ReturnType<typeof createBus>;
    persistence?: boolean;
  }) {
    const scope = createScope(options.haManager);
    service = new TransportService(
      scope as never,
      options.persistence === false ? undefined : ({ redis: { host: 'localhost' } } as never),
      options.bus as unknown as TransportBus | undefined,
    );
    await service.ready;
    return { service, scope };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.get.mockResolvedValue(null);
  });

  afterEach(async () => {
    await service?.destroy();
    service = undefined;
  });

  describe('getTransporter', () => {
    it('relays a session owned by a live node', async () => {
      const bus = createBus({ lookup: jest.fn().mockResolvedValue({ nodeId: 'node-a', channel: 'c' }) });
      const { service } = await createService({ haManager: createHaManager({ 'node-a': true }), bus });

      const transporter = await service.getTransporter('streamable-http', TOKEN, 'sess-1');

      expect(transporter).toBeInstanceOf(RemoteTransporter);
      expect((transporter as RemoteTransporter).ownerNodeId).toBe('node-a');
    });

    it('lets the caller take over a session whose owner stopped', async () => {
      const bus = createBus({ lookup: jest.fn().mockResolvedValue({ nodeId: 'node-dead', channel: 'c' }) });
      const { service, scope } = await createService({ haManager: createHaManager(), bus });

      await expect(service.getTransporter('streamable-http', TOKEN, 'sess-1')).resolves.toBeUndefined();
      expect(scope.logger.info).toHaveBeenCalledWith(
        '[HA] Session owner is gone — the session will be taken over',
        expect.objectContaining({ previousNodeId: 'node-dead' }),
      );
    });

    it('treats an owner as alive when heartbeats cannot be read, or without an HA manager', async () => {
      const lookup = jest.fn().mockResolvedValue({ nodeId: 'node-a', channel: 'c' });
      const haManager = createHaManager();
      haManager.isNodeAlive.mockRejectedValue(new Error('redis down'));
      const first = await createService({ haManager, bus: createBus({ lookup }) });
      expect(await first.service.getTransporter('streamable-http', TOKEN, 'sess-1')).toBeInstanceOf(RemoteTransporter);
      await first.service.destroy();

      const second = await createService({ bus: createBus({ lookup }) });
      expect(await second.service.getTransporter('streamable-http', TOKEN, 'sess-1')).toBeInstanceOf(RemoteTransporter);
    });

    it('re-advertises a session it serves, at most every 15 minutes', async () => {
      jest.useFakeTimers({ now: 1_000_000 });
      try {
        const bus = createBus();
        const { service } = await createService({ haManager: createHaManager(), bus });
        await service.createTransporter('streamable-http', TOKEN, 'sess-1', response);
        bus.advertise.mockClear();

        await service.getTransporter('streamable-http', TOKEN, 'sess-1');
        await service.getTransporter('streamable-http', TOKEN, 'sess-1');
        expect(bus.advertise).toHaveBeenCalledTimes(1);

        jest.setSystemTime(1_000_000 + 15 * 60 * 1000);
        await service.getTransporter('streamable-http', TOKEN, 'sess-1');
        expect(bus.advertise).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('logs a failed re-advertisement', async () => {
      const bus = createBus();
      const { service, scope } = await createService({ haManager: createHaManager(), bus });
      await service.createTransporter('streamable-http', TOKEN, 'sess-1', response);
      bus.advertise.mockRejectedValueOnce(new Error('redis down'));

      await service.getTransporter('streamable-http', TOKEN, 'sess-1');
      await new Promise((resolve) => setImmediate(resolve));

      expect(scope.logger.warn).toHaveBeenCalledWith(
        '[HA] Failed to refresh the session advertisement',
        expect.objectContaining({ error: 'redis down' }),
      );
    });
  });

  describe('recreateTransporter', () => {
    it('relays to a live owner instead of taking its session', async () => {
      const haManager = createHaManager({ 'node-a': true });
      const { service } = await createService({ haManager, bus: createBus() });

      const transporter = await service.recreateTransporter(
        'streamable-http',
        TOKEN,
        'sess-1',
        storedSession('node-a') as never,
        response,
      );

      expect(transporter).toBeInstanceOf(RemoteTransporter);
      expect(haManager.attemptTakeover).not.toHaveBeenCalled();
    });

    it('takes over the session of a stopped node and advertises it', async () => {
      const haManager = createHaManager();
      haManager.attemptTakeover.mockResolvedValue({ claimed: true, reassignedAt: 1234 });
      const bus = createBus();
      const { service, scope } = await createService({ haManager, bus });

      const transporter = await service.recreateTransporter(
        'streamable-http',
        TOKEN,
        'sess-1',
        storedSession('node-dead') as never,
        response,
      );

      expect(transporter).not.toBeInstanceOf(RemoteTransporter);
      expect(haManager.attemptTakeover).toHaveBeenCalledWith('mcp:transport:session:sess-1', 'node-dead');
      // The record written back names this node — not the stopped one it was read from — and
      // keeps the audit fields the takeover recorded.
      expect(mockStore.set).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({
          session: expect.objectContaining({ nodeId: 'node-local' }),
          reassignedAt: 1234,
          reassignedFrom: 'node-dead',
        }),
        expect.any(Number),
      );
      expect(bus.advertise).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-1' }));
      expect(scope.logger.info).toHaveBeenCalledWith(
        '[HA] Took over session from a stopped node',
        expect.objectContaining({ previousNodeId: 'node-dead' }),
      );
    });

    it('relays to the node that claimed the session first', async () => {
      const haManager = createHaManager({ 'node-c': true });
      haManager.attemptTakeover.mockResolvedValue({ claimed: false });
      mockStore.get.mockResolvedValue(storedSession('node-c'));
      const { service } = await createService({ haManager, bus: createBus() });

      const transporter = await service.recreateTransporter(
        'streamable-http',
        TOKEN,
        'sess-1',
        storedSession('node-dead') as never,
        response,
      );

      expect((transporter as RemoteTransporter).ownerNodeId).toBe('node-c');
    });

    it("serves the session when this node's orphan scanner claimed it first", async () => {
      const haManager = createHaManager();
      haManager.attemptTakeover.mockResolvedValue({ claimed: false });
      mockStore.get.mockResolvedValue({
        ...storedSession('node-local'),
        reassignedAt: 99,
        reassignedFrom: 'node-dead',
      });
      const { service } = await createService({ haManager, bus: createBus() });

      const transporter = await service.recreateTransporter(
        'streamable-http',
        TOKEN,
        'sess-1',
        storedSession('node-dead') as never,
        response,
      );

      expect(transporter).not.toBeInstanceOf(RemoteTransporter);
      expect(mockStore.set).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({ reassignedAt: 99, reassignedFrom: 'node-dead' }),
        expect.any(Number),
      );
    });

    it('reports a conflict when the session vanished or its new owner is gone too', async () => {
      const haManager = createHaManager();
      haManager.attemptTakeover.mockResolvedValue({ claimed: false });
      const { service } = await createService({ haManager, bus: createBus() });

      await expect(
        service.recreateTransporter('streamable-http', TOKEN, 'sess-1', storedSession('node-dead') as never, response),
      ).rejects.toBeInstanceOf(SessionClaimConflictError);

      mockStore.get.mockResolvedValue(storedSession('node-also-dead'));
      await expect(
        service.recreateTransporter('streamable-http', TOKEN, 'sess-2', storedSession('node-dead') as never, response),
      ).rejects.toBeInstanceOf(SessionClaimConflictError);
    });
  });

  describe('findRemoteSessionOwner', () => {
    it('routes a session owned by another live node to it', async () => {
      const bus = createBus({ lookupOwner: jest.fn().mockResolvedValue({ nodeId: 'node-a', channel: 'c-a' }) });
      const { service } = await createService({ haManager: createHaManager({ 'node-a': true }), bus });

      await expect(service.findRemoteSessionOwner(request())).resolves.toEqual({ nodeId: 'node-a', channel: 'c-a' });
      expect(bus.lookupOwner).toHaveBeenCalledWith('sess-1');
    });

    it('finds the session id of a legacy SSE message in the query', async () => {
      const bus = createBus({ lookupOwner: jest.fn().mockResolvedValue({ nodeId: 'node-a', channel: 'c-a' }) });
      const { service } = await createService({ haManager: createHaManager({ 'node-a': true }), bus });

      await service.findRemoteSessionOwner(request({}, { query: { sessionId: 'sse-1' } }));
      expect(bus.lookupOwner).toHaveBeenCalledWith('sse-1');
    });

    it('falls back to the persisted session record', async () => {
      mockStore.get.mockResolvedValue(storedSession('node-a'));
      const { service } = await createService({ haManager: createHaManager({ 'node-a': true }), bus: createBus() });

      await expect(service.findRemoteSessionOwner(request())).resolves.toEqual({
        nodeId: 'node-a',
        channel: 'mcp:ha:notify:node-a',
      });
    });

    it('serves here what it owns, cannot route, or whose owner stopped', async () => {
      const lookupOwner = jest.fn().mockResolvedValue({ nodeId: 'node-local', channel: 'c' });
      const { service } = await createService({ haManager: createHaManager(), bus: createBus({ lookupOwner }) });
      // owned here
      await expect(service.findRemoteSessionOwner(request())).resolves.toBeUndefined();
      // owner stopped
      lookupOwner.mockResolvedValueOnce({ nodeId: 'node-dead', channel: 'c' });
      await expect(service.findRemoteSessionOwner(request())).resolves.toBeUndefined();
      // unknown session
      lookupOwner.mockResolvedValueOnce(null);
      await expect(service.findRemoteSessionOwner(request())).resolves.toBeUndefined();
      // a stored record without an owner
      lookupOwner.mockResolvedValueOnce(null);
      mockStore.get.mockResolvedValueOnce(storedSession(undefined));
      await expect(service.findRemoteSessionOwner(request())).resolves.toBeUndefined();
      // no session id, or an absurd one
      await expect(service.findRemoteSessionOwner(request({}))).resolves.toBeUndefined();
      await expect(
        service.findRemoteSessionOwner(request({ 'mcp-session-id': 'x'.repeat(5000) })),
      ).resolves.toBeUndefined();
      // already relayed once
      await expect(
        service.findRemoteSessionOwner(request(undefined, { [ServerRequestTokens.relayedFrom]: 'node-b' })),
      ).resolves.toBeUndefined();
    });

    it('serves a session it holds without asking Redis', async () => {
      const bus = createBus({ lookupOwner: jest.fn().mockResolvedValue({ nodeId: 'node-a', channel: 'c' }) });
      const { service } = await createService({ haManager: createHaManager({ 'node-a': true }), bus });
      await service.createTransporter('streamable-http', TOKEN, 'sess-1', response);

      await expect(service.findRemoteSessionOwner(request())).resolves.toBeUndefined();
      expect(bus.lookupOwner).not.toHaveBeenCalled();
    });

    it('does not route outside a distributed deployment or before the relay is ready', async () => {
      const notDistributed = await createService({ haManager: createHaManager() });
      await expect(notDistributed.service.findRemoteSessionOwner(request())).resolves.toBeUndefined();
      await notDistributed.service.destroy();

      const notReady = await createService({
        haManager: createHaManager(),
        bus: createBus({ canRelay: jest.fn(() => false) }),
      });
      await expect(notReady.service.findRemoteSessionOwner(request())).resolves.toBeUndefined();
    });

    it('serves here when the owner cannot be looked up', async () => {
      const bus = createBus({ lookupOwner: jest.fn().mockRejectedValue(new Error('redis down')) });
      const { service, scope } = await createService({ haManager: createHaManager(), bus });

      await expect(service.findRemoteSessionOwner(request())).resolves.toBeUndefined();
      expect(scope.logger.warn).toHaveBeenCalledWith(
        '[HA] Could not resolve the session owner — serving the request here',
        expect.objectContaining({ error: 'redis down' }),
      );

      bus.lookupOwner.mockRejectedValueOnce('plain failure');
      await expect(service.findRemoteSessionOwner(request())).resolves.toBeUndefined();
    });
  });

  describe('lookupSessionOwner', () => {
    it('needs the bus, and reads the store only when the bus does not know the session', async () => {
      const noBus = await createService({ haManager: createHaManager() });
      await expect(noBus.service.lookupSessionOwner('sess-1')).resolves.toBeUndefined();
      await noBus.service.destroy();

      const withoutStore = await createService({ haManager: createHaManager(), bus: createBus(), persistence: false });
      await expect(withoutStore.service.lookupSessionOwner('sess-1')).resolves.toBeUndefined();
    });
  });

  describe('relayToSessionOwner', () => {
    it('relays through the bus with the presented session id', async () => {
      const bus = createBus();
      const { service } = await createService({ haManager: createHaManager(), bus });
      const location: RemoteLocation = { nodeId: 'node-a', channel: 'c' };
      const req = request();

      await service.relayToSessionOwner(location, req, response);
      expect(bus.proxyRequest).toHaveBeenCalledWith(location, 'sess-1', req, response);

      await service.relayToSessionOwner(location, request({}), response);
      expect(bus.proxyRequest).toHaveBeenLastCalledWith(location, '', expect.anything(), response);
    });

    it('needs the bus', async () => {
      const { service } = await createService({ haManager: createHaManager() });
      await expect(
        service.relayToSessionOwner({ nodeId: 'node-a', channel: 'c' }, request(), response),
      ).rejects.toBeInstanceOf(InvalidTransportSessionError);
    });
  });

  describe('adoptClaimedSession', () => {
    it('advertises a claimed session so every node routes it here', async () => {
      const bus = createBus();
      const { service, scope } = await createService({ haManager: createHaManager(), bus });

      await service.adoptClaimedSession('sess-1', 'node-dead', {
        protocol: 'streamable-http',
        authorizationId: TOKEN_HASH,
      });

      expect(bus.advertise).toHaveBeenCalledWith({
        type: 'streamable-http',
        token: '',
        tokenHash: TOKEN_HASH,
        sessionId: 'sess-1',
      });
      expect(scope.logger.info).toHaveBeenCalledWith(
        '[HA] Adopted an orphaned session — this node now serves it',
        expect.objectContaining({ previousNodeId: 'node-dead' }),
      );
    });

    it('skips records it cannot route', async () => {
      const bus = createBus();
      const { service } = await createService({ haManager: createHaManager(), bus });
      await service.adoptClaimedSession('sess-1', 'node-dead', { protocol: 'streamable-http' });
      await service.adoptClaimedSession('sess-1', 'node-dead', { protocol: 'stdio', authorizationId: 'h' });
      expect(bus.advertise).not.toHaveBeenCalled();

      const noBus = await createService({ haManager: createHaManager() });
      await expect(
        noBus.service.adoptClaimedSession('sess-1', 'node-dead', { protocol: 'sse', authorizationId: 'h' }),
      ).resolves.toBeUndefined();
      await noBus.service.destroy();
    });
  });

  describe('destroyLocalSession', () => {
    it("destroys this node's transports for a session", async () => {
      const bus = createBus();
      const { service } = await createService({ haManager: createHaManager(), bus });
      const streamable = await service.createTransporter('streamable-http', TOKEN, 'sess-1', response);
      const other = await service.createTransporter('streamable-http', 'other-token', 'sess-1', response);
      await service.getOrCreateAuthenticatedStatelessTransport('stateless-http', TOKEN, response);

      await expect(service.destroyLocalSession('sess-1', 'remote destroy')).resolves.toBe(true);

      expect(streamable.destroy).toHaveBeenCalledWith('remote destroy');
      expect(other.destroy).toHaveBeenCalledWith('remote destroy');
      expect(bus.revoke).toHaveBeenCalled();
      await expect(service.destroyLocalSession('sess-1')).resolves.toBe(false);
      // Once gone, the session is routed again.
      bus.lookupOwner.mockResolvedValueOnce(null);
      await service.findRemoteSessionOwner(request());
      expect(bus.lookupOwner).toHaveBeenCalledWith('sess-1');
    });
  });
});
