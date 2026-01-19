import * as net from 'net';
import { ManagerTransport } from './base.transport';
import type { ManagerServerMessage } from '../manager.types';
import type { TcpTransportOptions } from '../manager.options';

// ─────────────────────────────────────────────────────────────────────────────
// TCP Socket Transport
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TCP socket transport for orchestrator/external service connections.
 * Provides network-accessible communication for remote management.
 */
export class TcpSocketTransport extends ManagerTransport {
  readonly type = 'tcp' as const;

  private server: net.Server | null = null;
  private sockets = new Map<string, net.Socket>();
  private actualPort: number = 0;

  constructor(private options: TcpTransportOptions) {
    super();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));

      this.server.on('error', (err) => {
        this.emit('error', err);
        if (!this.running) {
          reject(err);
        }
      });

      this.server.listen(this.options.port, this.options.host, () => {
        this.running = true;
        const addr = this.server!.address() as net.AddressInfo;
        this.actualPort = addr.port;
        this.address = `${this.options.host}:${this.actualPort}`;
        this.emit('listening', this.address);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.running || !this.server) {
      return;
    }

    // Close all client connections
    for (const [clientId, socket] of this.sockets) {
      socket.destroy();
      this.unregisterClient(clientId, 'server shutdown');
    }
    this.sockets.clear();

    // Close the server
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.running = false;
        this.emit('close');
        resolve();
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Connection Handling
  // ─────────────────────────────────────────────────────────────────────────

  private handleConnection(socket: net.Socket): void {
    const clientId = this.generateClientId();
    this.sockets.set(clientId, socket);

    // Get remote address
    const remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`;

    // Register client
    this.registerClient(clientId, remoteAddress);

    // Set up line-based parsing
    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString('utf-8');

      // Process complete lines (messages are newline-delimited)
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.trim()) {
          const message = this.parseMessage(line);
          if (message) {
            this.emit('command', clientId, message);
          }
        }
      }
    });

    socket.on('close', () => {
      this.sockets.delete(clientId);
      this.unregisterClient(clientId, 'connection closed');
    });

    socket.on('error', (err) => {
      // Connection errors are common (client disconnect), don't emit as transport error
      this.sockets.delete(clientId);
      this.unregisterClient(clientId, `error: ${err.message}`);
    });

    // Set keep-alive to detect dead connections
    socket.setKeepAlive(true, 30000);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Message Sending
  // ─────────────────────────────────────────────────────────────────────────

  send(clientId: string, message: ManagerServerMessage): boolean {
    const socket = this.sockets.get(clientId);
    if (!socket || socket.destroyed) {
      return false;
    }

    try {
      socket.write(this.serializeMessage(message));
      return true;
    } catch {
      return false;
    }
  }

  disconnectClient(clientId: string, reason?: string): void {
    const socket = this.sockets.get(clientId);
    if (socket) {
      socket.destroy();
      this.sockets.delete(clientId);
      this.unregisterClient(clientId, reason);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Accessors
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the actual port the server is listening on.
   * Useful when port 0 was specified (auto-assign).
   */
  getPort(): number {
    return this.actualPort;
  }

  /**
   * Get the host the server is bound to.
   */
  getHost(): string {
    return this.options.host;
  }
}
