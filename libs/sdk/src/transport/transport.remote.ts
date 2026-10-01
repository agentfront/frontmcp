import { type RequestId } from '@frontmcp/protocol';

import { type ServerResponse } from '../common';
import { MethodNotImplementedError, SessionOwnerUnreachableError } from '../errors/transport.errors';
import { type AuthenticatedServerRequest } from '../server/server.types';
import { rpcError } from './transport.error';
import {
  type RemoteLocation,
  type TransportBus,
  type Transporter,
  type TransportKey,
  type TransportType,
} from './transport.types';

/**
 * Transporter for a session owned by another live node of a distributed deployment.
 *
 * Requests are relayed to the owning node, which serves them on its own transport;
 * its response is streamed back to this node's client. When the owner cannot be
 * reached the client gets a retryable `503` instead.
 */
export class RemoteTransporter implements Transporter {
  readonly type: TransportType;
  readonly tokenHash: string;
  readonly sessionId: string;

  constructor(
    private readonly key: TransportKey,
    private readonly bus: TransportBus,
    private readonly location: RemoteLocation,
  ) {
    this.type = key.type;
    this.tokenHash = key.tokenHash;
    this.sessionId = key.sessionId;
  }

  /** The node that owns the session. */
  get ownerNodeId(): string {
    return this.location.nodeId;
  }

  ping(_timeoutMs?: number): Promise<boolean> {
    throw new MethodNotImplementedError('RemoteTransporter', 'ping');
  }

  initialize(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void> {
    return this.relay(req, res);
  }

  handleRequest(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void> {
    return this.relay(req, res);
  }

  async destroy(reason?: string): Promise<void> {
    await this.bus.destroyRemote(this.key, reason);
  }

  get isInitialized(): boolean {
    return true;
  }

  markAsInitialized(): void {
    // No-op for remote transporters - initialization state is managed on the remote node
  }

  resetForReinitialization(): void {
    // No-op for remote transporters - initialization state is managed on the remote node
  }

  reregisterServer(): void {
    // No-op for remote transporters - server registration is managed on the remote node
  }

  private async relay(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void> {
    try {
      await this.bus.proxyRequest(this.location, this.sessionId, req, res);
    } catch (error) {
      if (!(error instanceof SessionOwnerUnreachableError) || res.headersSent) throw error;
      const requestId = (req.body as { id?: RequestId } | undefined)?.id ?? null;
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      res.status(error.statusCode).json(rpcError(error.getPublicMessage(), requestId));
    }
  }
}
