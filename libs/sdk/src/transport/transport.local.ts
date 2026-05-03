import { type ServerResponse } from '../common';
import { MethodNotImplementedError, UnsupportedTransportTypeError } from '../errors/transport.errors';
import { type Scope } from '../scope';
import { type AuthenticatedServerRequest } from '../server/server.types';
import { type LocalTransportAdapter, type SupportedTransport } from './adapters/transport.local.adapter';
import { TransportSSEAdapter } from './adapters/transport.sse.adapter';
import { TransportStreamableHttpAdapter } from './adapters/transport.streamable-http.adapter';
import { rpcError } from './transport.error';
import { type Transporter, type TransportKey, type TransportType } from './transport.types';

export class LocalTransporter implements Transporter {
  readonly type: TransportType;
  readonly tokenHash: string;
  readonly sessionId: string;

  private adapter: LocalTransportAdapter<SupportedTransport>;

  constructor(
    scope: Scope,
    key: TransportKey,
    res: ServerResponse,
    private readonly onDispose?: () => void,
  ) {
    this.type = key.type;
    this.tokenHash = key.tokenHash;

    const defaultOnDispose = () => {
      /* empty */
    };

    switch (this.type) {
      case 'sse':
        this.adapter = new TransportSSEAdapter(scope, key, onDispose ?? defaultOnDispose, res);
        break;
      case 'streamable-http':
      case 'stateless-http':
        // Both streamable-http and stateless-http use the same underlying adapter
        // The difference is in how the transport is managed (singleton vs per-session)
        this.adapter = new TransportStreamableHttpAdapter(scope, key, onDispose ?? defaultOnDispose, res);
        break;
      default:
        throw new UnsupportedTransportTypeError(this.type);
    }
  }

  ping(timeoutMs?: number): Promise<boolean> {
    throw new MethodNotImplementedError('LocalTransporter', 'ping');
  }

  async handleRequest(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void> {
    try {
      await this.adapter.handleRequest(req, res);
    } catch (err) {
      // Use safe logging to avoid Node.js 24 util.inspect bug with Zod errors
      console.error('MCP POST error:', err instanceof Error ? err.message : 'Unknown error');
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
      // Use safe logging to avoid Node.js 24 util.inspect bug with Zod errors
      console.error('MCP POST error:', err instanceof Error ? err.message : 'Unknown error');
      res.status(500).json(rpcError('Internal error'));
    }
  }

  get isInitialized(): boolean {
    return this.adapter.isInitialized;
  }

  /**
   * Marks this transport as pre-initialized for session recreation.
   * This is needed when recreating a transport from Redis because the
   * original initialize request was processed by a different transport instance.
   */
  markAsInitialized(): void {
    this.adapter.markAsInitialized();
  }

  resetForReinitialization(): void {
    this.adapter.resetForReinitialization();
  }

  reregisterServer(): void {
    this.adapter.reregisterServer();
  }

  async destroy(reason: string): Promise<void> {
    try {
      await this.adapter.destroy(reason);
    } finally {
      this.onDispose?.();
    }
  }
}
