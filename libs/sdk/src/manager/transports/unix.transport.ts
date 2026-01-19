import * as net from 'net';
import { unlink } from '@frontmcp/utils';
import { ManagerTransport } from './base.transport';
import type { ManagerServerMessage, ManagerCommandMessage } from '../manager.types';
import { resolveSocketPath, type UnixTransportOptions } from '../manager.options';

// ─────────────────────────────────────────────────────────────────────────────
// Unix Socket Transport
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unix socket transport for local TUI connections.
 * Provides low-latency, secure communication for same-machine clients.
 */
export class UnixSocketTransport extends ManagerTransport {
  readonly type = 'unix' as const;

  private server: net.Server | null = null;
  private sockets = new Map<string, net.Socket>();
  private socketPath: string;

  constructor(private options: UnixTransportOptions) {
    super();
    this.socketPath = resolveSocketPath(options.path);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    // Clean up stale socket file if it exists
    await this.cleanupSocketFile();

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));

      this.server.on('error', (err) => {
        this.emit('error', err);
        if (!this.running) {
          reject(err);
        }
      });

      this.server.listen(this.socketPath, () => {
        this.running = true;
        this.address = this.socketPath;
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
      this.server!.close(async () => {
        this.running = false;
        await this.cleanupSocketFile();
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

    // Register client
    this.registerClient(clientId, 'unix:local');

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
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async cleanupSocketFile(): Promise<void> {
    try {
      await unlink(this.socketPath);
    } catch {
      // Ignore errors - file might not exist
    }
  }

  /**
   * Get the socket path this transport is using.
   */
  getSocketPath(): string {
    return this.socketPath;
  }
}
