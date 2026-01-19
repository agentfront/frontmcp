import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import type {
  ManagerServerMessage,
  ManagerCommandMessage,
  ManagerClientInfo,
  ManagerEventCategory,
} from '../manager.types';

// ─────────────────────────────────────────────────────────────────────────────
// Transport Events
// ─────────────────────────────────────────────────────────────────────────────

export interface ManagerTransportEvents {
  /** Emitted when transport starts listening */
  listening: (address: string) => void;
  /** Emitted when a client connects */
  clientConnect: (client: ManagerClientInfo) => void;
  /** Emitted when a client disconnects */
  clientDisconnect: (clientId: string, reason?: string) => void;
  /** Emitted when a command is received from a client */
  command: (clientId: string, message: ManagerCommandMessage) => void;
  /** Emitted on transport error */
  error: (error: Error) => void;
  /** Emitted when transport closes */
  close: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Abstract Base Transport
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Abstract base class for Manager transports.
 * Provides common functionality for Unix, TCP, and WebSocket transports.
 */
export abstract class ManagerTransport extends EventEmitter {
  /** Transport type identifier */
  abstract readonly type: 'unix' | 'tcp' | 'websocket';

  /** Connected clients */
  protected clients = new Map<string, ManagerClientInfo>();

  /** Whether the transport is running */
  protected running = false;

  /** Transport-specific address (socket path, host:port, etc.) */
  protected address: string = '';

  constructor() {
    super();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle Methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start the transport and begin accepting connections.
   * @returns Promise that resolves when the transport is listening
   */
  abstract start(): Promise<void>;

  /**
   * Stop the transport and close all connections.
   * @returns Promise that resolves when the transport is fully stopped
   */
  abstract stop(): Promise<void>;

  /**
   * Check if the transport is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the address the transport is listening on.
   */
  getAddress(): string {
    return this.address;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Message Sending
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Send a message to a specific client.
   * @param clientId The client to send to
   * @param message The message to send
   * @returns true if message was sent, false if client not found
   */
  abstract send(clientId: string, message: ManagerServerMessage): boolean;

  /**
   * Broadcast a message to all connected clients.
   * Optionally filter by subscription.
   * @param message The message to broadcast
   * @param filter Optional filter function
   * @returns Number of clients the message was sent to
   */
  broadcast(message: ManagerServerMessage, filter?: (client: ManagerClientInfo) => boolean): number {
    let count = 0;
    for (const [clientId, client] of this.clients) {
      if (!filter || filter(client)) {
        if (this.send(clientId, message)) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Broadcast to clients subscribed to a specific event category.
   */
  broadcastToSubscribed(message: ManagerServerMessage, category: ManagerEventCategory): number {
    return this.broadcast(message, (client) => {
      // If client has no subscriptions, they receive all events
      if (client.subscribedCategories.size === 0) {
        return true;
      }
      return client.subscribedCategories.has(category);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Client Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all connected clients.
   */
  getClients(): ManagerClientInfo[] {
    return Array.from(this.clients.values());
  }

  /**
   * Get a specific client by ID.
   */
  getClient(clientId: string): ManagerClientInfo | undefined {
    return this.clients.get(clientId);
  }

  /**
   * Get the number of connected clients.
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Update client subscription preferences.
   */
  updateClientSubscription(clientId: string, categories?: ManagerEventCategory[], types?: string[]): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    if (categories !== undefined) {
      client.subscribedCategories = new Set(categories);
    }
    if (types !== undefined) {
      client.subscribedTypes = new Set(types);
    }

    return true;
  }

  /**
   * Disconnect a specific client.
   */
  abstract disconnectClient(clientId: string, reason?: string): void;

  // ─────────────────────────────────────────────────────────────────────────
  // Protected Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Generate a unique client ID.
   */
  protected generateClientId(): string {
    return nanoid(12);
  }

  /**
   * Register a new client connection.
   */
  protected registerClient(clientId: string, remoteAddress?: string): ManagerClientInfo {
    const client: ManagerClientInfo = {
      id: clientId,
      transport: this.type,
      connectedAt: Date.now(),
      remoteAddress,
      subscribedCategories: new Set(),
      subscribedTypes: new Set(),
    };
    this.clients.set(clientId, client);
    this.emit('clientConnect', client);
    return client;
  }

  /**
   * Unregister a client connection.
   */
  protected unregisterClient(clientId: string, reason?: string): void {
    if (this.clients.has(clientId)) {
      this.clients.delete(clientId);
      this.emit('clientDisconnect', clientId, reason);
    }
  }

  /**
   * Parse an incoming message from a client.
   */
  protected parseMessage(data: string | Buffer): ManagerCommandMessage | null {
    try {
      const str = typeof data === 'string' ? data : data.toString('utf-8');
      const parsed = JSON.parse(str);

      // Validate it's a command message
      if (parsed && typeof parsed === 'object' && parsed.type === 'command') {
        return parsed as ManagerCommandMessage;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Serialize a message for sending.
   */
  protected serializeMessage(message: ManagerServerMessage): string {
    return JSON.stringify(message) + '\n';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport Manager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages multiple transports and provides a unified interface.
 */
export class TransportManager extends EventEmitter {
  private transports: ManagerTransport[] = [];
  private running = false;

  /**
   * Add a transport to the manager.
   */
  addTransport(transport: ManagerTransport): void {
    this.transports.push(transport);

    // Forward events
    transport.on('clientConnect', (client) => this.emit('clientConnect', client));
    transport.on('clientDisconnect', (clientId, reason) => this.emit('clientDisconnect', clientId, reason));
    transport.on('command', (clientId, message) => this.emit('command', clientId, message));
    transport.on('error', (error) => this.emit('error', transport.type, error));
  }

  /**
   * Start all transports.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    await Promise.all(this.transports.map((t) => t.start()));
    this.running = true;
  }

  /**
   * Stop all transports.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    await Promise.all(this.transports.map((t) => t.stop()));
    this.running = false;
    this.emit('close');
  }

  /**
   * Check if the manager is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get all transports.
   */
  getTransports(): ManagerTransport[] {
    return [...this.transports];
  }

  /**
   * Get all connected clients across all transports.
   */
  getAllClients(): ManagerClientInfo[] {
    return this.transports.flatMap((t) => t.getClients());
  }

  /**
   * Get total client count.
   */
  getTotalClientCount(): number {
    return this.transports.reduce((sum, t) => sum + t.getClientCount(), 0);
  }

  /**
   * Send a message to a specific client (searches all transports).
   */
  send(clientId: string, message: ManagerServerMessage): boolean {
    for (const transport of this.transports) {
      if (transport.send(clientId, message)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Broadcast a message to all clients on all transports.
   */
  broadcast(message: ManagerServerMessage, filter?: (client: ManagerClientInfo) => boolean): number {
    return this.transports.reduce((count, t) => count + t.broadcast(message, filter), 0);
  }

  /**
   * Broadcast to clients subscribed to a category.
   */
  broadcastToSubscribed(message: ManagerServerMessage, category: ManagerEventCategory): number {
    return this.transports.reduce((count, t) => count + t.broadcastToSubscribed(message, category), 0);
  }

  /**
   * Update a client's subscription (searches all transports).
   */
  updateClientSubscription(clientId: string, categories?: ManagerEventCategory[], types?: string[]): boolean {
    for (const transport of this.transports) {
      if (transport.updateClientSubscription(clientId, categories, types)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get addresses of all listening transports.
   */
  getAddresses(): Record<string, string> {
    const addresses: Record<string, string> = {};
    for (const transport of this.transports) {
      if (transport.isRunning()) {
        addresses[transport.type] = transport.getAddress();
      }
    }
    return addresses;
  }
}
