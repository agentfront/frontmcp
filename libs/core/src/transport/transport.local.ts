import { Transporter, TransportKey, TransportType } from './transport.types';
import { AuthenticatedServerRequest } from '../server/server.types';
import { TransportSSEAdapter } from './adapters/transport.sse.adapter';
import { TransportStreamableHttpAdapter } from './adapters/transport.streamable-http.adapter';
import { rpcError } from './transport.error';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { LocalTransportAdapter } from './adapters/transport.local.adapter';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from './legacy/legacy.sse.tranporter';
import { ServerResponse } from '@frontmcp/sdk';
import { Scope } from '../scope';

export class LocalTransporter implements Transporter {
  readonly type: TransportType;
  readonly tokenHash: string;
  readonly sessionId: string;

  private adapter: LocalTransportAdapter<StreamableHTTPServerTransport | SSEServerTransport>;

  constructor(scope: Scope, key: TransportKey, res: ServerResponse, private readonly onDispose?: () => void) {
    this.type = key.type;
    this.tokenHash = key.tokenHash;

    const defaultOnDispose = () => {
    };

    switch (this.type) {
      case 'sse':
        this.adapter = new TransportSSEAdapter(scope, key, onDispose ?? defaultOnDispose, res);
        break;
      case 'streamable-http':
        this.adapter = new TransportStreamableHttpAdapter(scope, key, onDispose ?? defaultOnDispose, res);
        break;
      default:
        throw new Error(`Unsupported transport type: ${this.type}`);
    }
  }

  ping(timeoutMs?: number): Promise<boolean> {
    throw new Error('Method not implemented.');
  }

  async handleRequest(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void> {
    try {
      await this.adapter.handleRequest(req, res);
    } catch (err) {
      console.error('MCP POST error:', err);
      res.status(500).json(rpcError('Internal error'));
    }
  }

  async ready(): Promise<void> {
    return this.adapter.ready;
  }

  async initialize(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void> {
    try {
      await this.adapter.ready;
      return this.adapter.initialize(req, res);
    } catch (err) {
      console.error('MCP POST error:', err);
      res.status(500).json(rpcError('Internal error'));
    }
  }

  async destroy(reason: string): Promise<void> {
    try {
      await this.adapter.destroy(reason);
    } finally {
      this.onDispose?.();
    }
  }
}
