import { TransportBus, Transporter, TransportKey, TransportType } from './transport.types';
import { AuthenticatedServerRequest } from '../server/server.types';
import { ServerResponse } from '@frontmcp/sdk';

export class RemoteTransporter implements Transporter {
  readonly type: TransportType;
  readonly tokenHash: string;
  readonly sessionId: string;

  constructor(private readonly key: TransportKey, private readonly bus: TransportBus) {
    this.type = key.type;
    this.tokenHash = key.tokenHash;
    this.sessionId = key.sessionId;
  }
  ping(timeoutMs?: number): Promise<boolean> {
    throw new Error('Method not implemented.');
  }

  initialize(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async handleRequest(_req: AuthenticatedServerRequest, _res: ServerResponse): Promise<void> {
    throw new Error('RemoteTransporter: handleRequest() not implemented.');
  }

  async destroy(_reason?: string): Promise<void> {
    throw new Error('RemoteTransporter: destroy() not implemented.');
  }
}
