import { TransportBus, Transporter, TransportKey, TransportType } from './transport.types';
import { AuthenticatedServerRequest } from '../server/server.types';
import { ServerResponse } from '../common';
import { MethodNotImplementedError } from '../errors/transport.errors';

export class RemoteTransporter implements Transporter {
  readonly type: TransportType;
  readonly tokenHash: string;
  readonly sessionId: string;

  constructor(
    private readonly key: TransportKey,
    private readonly bus: TransportBus,
  ) {
    this.type = key.type;
    this.tokenHash = key.tokenHash;
    this.sessionId = key.sessionId;
  }
  ping(timeoutMs?: number): Promise<boolean> {
    throw new MethodNotImplementedError('RemoteTransporter', 'ping');
  }

  initialize(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void> {
    throw new MethodNotImplementedError('RemoteTransporter', 'initialize');
  }

  async handleRequest(_req: AuthenticatedServerRequest, _res: ServerResponse): Promise<void> {
    throw new MethodNotImplementedError('RemoteTransporter', 'handleRequest');
  }

  async destroy(_reason?: string): Promise<void> {
    throw new MethodNotImplementedError('RemoteTransporter', 'destroy');
  }

  markAsInitialized(): void {
    // No-op for remote transporters - initialization state is managed on the remote node
  }
}
