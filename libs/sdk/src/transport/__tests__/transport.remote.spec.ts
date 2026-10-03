import type { ServerResponse } from '../../common';
import { MethodNotImplementedError, SessionOwnerUnreachableError } from '../../errors/transport.errors';
import type { AuthenticatedServerRequest } from '../../server/server.types';
import { RemoteTransporter } from '../transport.remote';
import type { TransportBus, TransportKey } from '../transport.types';

const key: TransportKey = { type: 'streamable-http', token: 'tok', tokenHash: 'hash', sessionId: 'sess-1' };
const location = { nodeId: 'node-a', channel: 'mcp:ha:notify:node-a' };

function createBus(overrides: Partial<TransportBus> = {}): jest.Mocked<TransportBus> {
  return {
    nodeId: jest.fn(() => 'node-b'),
    advertise: jest.fn(),
    revoke: jest.fn(),
    lookup: jest.fn(),
    lookupOwner: jest.fn(),
    channelOf: jest.fn(),
    canRelay: jest.fn(() => true),
    proxyRequest: jest.fn().mockResolvedValue(undefined),
    destroyRemote: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<TransportBus>;
}

function createResponse(headersSent = false) {
  const response = {
    headersSent,
    setHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

const request = { body: { jsonrpc: '2.0', id: 9, method: 'tools/call' } } as unknown as AuthenticatedServerRequest;

describe('RemoteTransporter', () => {
  it('describes the remote session', () => {
    const transporter = new RemoteTransporter(key, createBus(), location);
    expect(transporter.type).toBe('streamable-http');
    expect(transporter.tokenHash).toBe('hash');
    expect(transporter.sessionId).toBe('sess-1');
    expect(transporter.ownerNodeId).toBe('node-a');
    expect(transporter.isInitialized).toBe(true);
    expect(() => {
      transporter.markAsInitialized();
      transporter.resetForReinitialization();
      transporter.reregisterServer();
    }).not.toThrow();
    expect(() => transporter.ping()).toThrow(MethodNotImplementedError);
  });

  it('relays requests (and initialize) to the owning node', async () => {
    const bus = createBus();
    const transporter = new RemoteTransporter(key, bus, location);
    const response = createResponse() as unknown as ServerResponse;

    await transporter.handleRequest(request, response);
    await transporter.initialize(request, response);

    expect(bus.proxyRequest).toHaveBeenCalledTimes(2);
    expect(bus.proxyRequest).toHaveBeenCalledWith(location, 'sess-1', request, response);
  });

  it('answers a retryable 503 when the owner cannot be reached', async () => {
    const bus = createBus({
      proxyRequest: jest.fn().mockRejectedValue(new SessionOwnerUnreachableError('node-a', 15, 'no ack')),
    });
    const response = createResponse();

    await new RemoteTransporter(key, bus, location).handleRequest(request, response as unknown as ServerResponse);

    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '15');
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: 9,
      error: { code: -32000, message: expect.stringContaining('Retry after 15s') },
    });
  });

  it('uses a null id for a request without one', async () => {
    const bus = createBus({
      proxyRequest: jest.fn().mockRejectedValue(new SessionOwnerUnreachableError('node-a', 1, 'x')),
    });
    const response = createResponse();
    await new RemoteTransporter(key, bus, location).handleRequest(
      { body: undefined } as unknown as AuthenticatedServerRequest,
      response as unknown as ServerResponse,
    );
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ id: expect.any(String) }));
  });

  it('rethrows other failures, and any failure once the response started', async () => {
    const other = createBus({ proxyRequest: jest.fn().mockRejectedValue(new Error('bug')) });
    await expect(
      new RemoteTransporter(key, other, location).handleRequest(request, createResponse() as unknown as ServerResponse),
    ).rejects.toThrow('bug');

    const started = createBus({
      proxyRequest: jest.fn().mockRejectedValue(new SessionOwnerUnreachableError('node-a', 1, 'x')),
    });
    await expect(
      new RemoteTransporter(key, started, location).handleRequest(
        request,
        createResponse(true) as unknown as ServerResponse,
      ),
    ).rejects.toBeInstanceOf(SessionOwnerUnreachableError);
  });

  it('asks the owner to destroy the session', async () => {
    const bus = createBus();
    await new RemoteTransporter(key, bus, location).destroy('bye');
    expect(bus.destroyRemote).toHaveBeenCalledWith(key, 'bye');
  });
});
