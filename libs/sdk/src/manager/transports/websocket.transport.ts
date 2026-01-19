import { createServer, type Server as HttpServer, type IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { ManagerTransport } from './base.transport';
import type { ManagerServerMessage } from '../manager.types';
import type { WebsocketTransportOptions } from '../manager.options';

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket Transport
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WebSocket transport for web dashboard connections.
 * Provides HTTP-based communication for browser clients.
 */
export class WebSocketTransport extends ManagerTransport {
  readonly type = 'websocket' as const;

  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private sockets = new Map<string, WebSocket>();
  private actualPort: number = 0;

  constructor(private options: WebsocketTransportOptions) {
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
      // Create HTTP server
      this.httpServer = createServer((req, res) => {
        // Simple health check endpoint
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', clients: this.getClientCount() }));
          return;
        }

        // Reject other HTTP requests (WebSocket upgrade will be handled by ws)
        res.writeHead(426, { 'Content-Type': 'text/plain' });
        res.end('Upgrade Required');
      });

      // Create WebSocket server
      this.wss = new WebSocketServer({
        server: this.httpServer,
        path: this.options.path,
      });

      this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

      this.wss.on('error', (err) => {
        this.emit('error', err);
      });

      this.httpServer.on('error', (err) => {
        this.emit('error', err);
        if (!this.running) {
          reject(err);
        }
      });

      this.httpServer.listen(this.options.port, this.options.host, () => {
        this.running = true;
        const addr = this.httpServer!.address() as { port: number };
        this.actualPort = addr.port;
        this.address = `ws://${this.options.host}:${this.actualPort}${this.options.path}`;
        this.emit('listening', this.address);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    // Close all client connections
    for (const [clientId, ws] of this.sockets) {
      ws.close(1001, 'Server shutdown');
      this.unregisterClient(clientId, 'server shutdown');
    }
    this.sockets.clear();

    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
    }

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
    }

    this.running = false;
    this.emit('close');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Connection Handling
  // ─────────────────────────────────────────────────────────────────────────

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientId = this.generateClientId();
    this.sockets.set(clientId, ws);

    // Get remote address from request
    const remoteAddress =
      req.headers['x-forwarded-for']?.toString().split(',')[0] || req.socket.remoteAddress || 'unknown';

    // Register client
    this.registerClient(clientId, remoteAddress);

    ws.on('message', (data) => {
      const message = this.parseMessage(data.toString());
      if (message) {
        this.emit('command', clientId, message);
      }
    });

    ws.on('close', (code, reason) => {
      this.sockets.delete(clientId);
      this.unregisterClient(clientId, `closed: ${code} ${reason}`);
    });

    ws.on('error', (err) => {
      this.sockets.delete(clientId);
      this.unregisterClient(clientId, `error: ${err.message}`);
    });

    // Set up ping/pong for connection health
    ws.on('pong', () => {
      // Connection is alive
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Message Sending
  // ─────────────────────────────────────────────────────────────────────────

  send(clientId: string, message: ManagerServerMessage): boolean {
    const ws = this.sockets.get(clientId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      // WebSocket doesn't need newline delimiter
      ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  disconnectClient(clientId: string, reason?: string): void {
    const ws = this.sockets.get(clientId);
    if (ws) {
      ws.close(1000, reason || 'Disconnected by server');
      this.sockets.delete(clientId);
      this.unregisterClient(clientId, reason);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Heartbeat
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Send ping to all clients to check connection health.
   * Dead connections will be detected and cleaned up.
   */
  pingAll(): void {
    for (const [clientId, ws] of this.sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        // Clean up dead connections
        this.sockets.delete(clientId);
        this.unregisterClient(clientId, 'connection dead');
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Accessors
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the actual port the server is listening on.
   */
  getPort(): number {
    return this.actualPort;
  }

  /**
   * Get the WebSocket path.
   */
  getPath(): string {
    return this.options.path;
  }

  /**
   * Get the full WebSocket URL.
   */
  getUrl(): string {
    return this.address;
  }
}
