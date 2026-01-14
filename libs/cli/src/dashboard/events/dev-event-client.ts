/**
 * Dev Event Client - Receives events from child process via IPC or stderr
 *
 * This client connects to the child process running the MCP server
 * and receives DevEvents for display in the dashboard.
 */

import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type { DevEvent, DevEventMessage } from './types.js';
import { DEV_EVENT_MAGIC, isDevEventMessage } from './types.js';
import { LineBuffer } from '../utils/line-buffer.js';

export type DevEventClientListener = (event: DevEvent) => void;

export interface DevEventClientOptions {
  /** Maximum events to buffer */
  bufferSize?: number;
}

/**
 * Ring buffer for storing events with fixed capacity.
 */
class RingBuffer<T> {
  private items: T[] = [];

  constructor(private readonly maxSize: number) {}

  push(item: T): void {
    if (this.items.length >= this.maxSize) {
      this.items.shift();
    }
    this.items.push(item);
  }

  getAll(): readonly T[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
  }

  get length(): number {
    return this.items.length;
  }
}

/**
 * DevEventClient receives events from a child process.
 *
 * It supports two transport modes:
 * 1. IPC: Node.js built-in IPC channel (preferred)
 * 2. stderr: JSON events written to stderr with magic prefix (fallback)
 *
 * @example
 * ```typescript
 * const client = new DevEventClient({ bufferSize: 1000 });
 *
 * client.subscribe((event) => {
 *   console.log(`[${event.type}]`, event.data);
 * });
 *
 * client.attach(childProcess);
 * ```
 */
export class DevEventClient extends EventEmitter {
  private readonly eventListeners = new Set<DevEventClientListener>();
  private readonly buffer: RingBuffer<DevEvent>;
  private childProcess: ChildProcess | null = null;
  private stderrLineBuffer = new LineBuffer();
  private isConnected = false;
  private connectionMode: 'ipc' | 'stderr' | 'none' = 'none';

  // Bound handlers for cleanup
  private boundHandleMessage: ((msg: unknown) => void) | null = null;
  private boundHandleStderr: ((data: Buffer) => void) | null = null;
  private boundHandleClose: (() => void) | null = null;

  constructor(options: DevEventClientOptions = {}) {
    super();
    this.buffer = new RingBuffer(options.bufferSize ?? 1000);
  }

  /**
   * Check if connected to child process.
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Get the current connection mode.
   */
  get mode(): 'ipc' | 'stderr' | 'none' {
    return this.connectionMode;
  }

  /**
   * Subscribe to events.
   */
  subscribe(listener: DevEventClientListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /**
   * Get all buffered events.
   */
  getBuffer(): readonly DevEvent[] {
    return this.buffer.getAll();
  }

  /**
   * Clear the event buffer.
   */
  clearBuffer(): void {
    this.buffer.clear();
  }

  /**
   * Attach to a child process to receive events.
   *
   * @param child - The child process to attach to
   */
  attach(child: ChildProcess): void {
    this.detach();

    this.childProcess = child;

    // Try IPC first
    if (typeof child.send === 'function') {
      this.connectionMode = 'ipc';
      this.boundHandleMessage = this.handleMessage.bind(this);
      child.on('message', this.boundHandleMessage);
    } else {
      // Fall back to stderr
      this.connectionMode = 'stderr';
    }

    // Always listen to stderr for fallback and log output
    if (child.stderr) {
      this.boundHandleStderr = this.handleStderr.bind(this);
      child.stderr.on('data', this.boundHandleStderr);
    }

    // Handle process close
    this.boundHandleClose = this.handleClose.bind(this);
    child.on('close', this.boundHandleClose);

    this.isConnected = true;
    this.emit('connected', this.connectionMode);
  }

  /**
   * Detach from the child process.
   */
  detach(): void {
    if (!this.childProcess) {
      return;
    }

    if (this.boundHandleMessage) {
      this.childProcess.off('message', this.boundHandleMessage);
      this.boundHandleMessage = null;
    }

    if (this.boundHandleStderr && this.childProcess.stderr) {
      this.childProcess.stderr.off('data', this.boundHandleStderr);
      this.boundHandleStderr = null;
    }

    if (this.boundHandleClose) {
      this.childProcess.off('close', this.boundHandleClose);
      this.boundHandleClose = null;
    }

    this.childProcess = null;
    this.isConnected = false;
    this.connectionMode = 'none';
    this.stderrLineBuffer.clear();
  }

  /**
   * Destroy the client and clean up resources.
   */
  destroy(): void {
    this.detach();
    this.eventListeners.clear();
    this.buffer.clear();
    this.removeAllListeners();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private handlers
  // ─────────────────────────────────────────────────────────────────────────

  private handleMessage(msg: unknown): void {
    if (isDevEventMessage(msg)) {
      this.receiveEvent(msg.event);
    }
  }

  private handleStderr(data: Buffer): void {
    // Use LineBuffer to properly handle incomplete lines
    const lines = this.stderrLineBuffer.push(data.toString());

    for (const line of lines) {
      if (line.startsWith(DEV_EVENT_MAGIC)) {
        try {
          const json = line.slice(DEV_EVENT_MAGIC.length);
          const event = JSON.parse(json) as DevEvent;
          this.receiveEvent(event);
        } catch (err) {
          // Invalid JSON, emit as log line
          this.emit('log', { level: 'error', message: `Invalid event JSON: ${line}` });
        }
      } else if (line.trim()) {
        // Regular stderr output - emit as log
        this.emit('log', { level: 'stderr', message: line });
      }
    }
  }

  private handleClose(): void {
    // Flush any remaining content in the line buffer
    const remaining = this.stderrLineBuffer.flush();
    if (remaining && remaining.trim()) {
      this.emit('log', { level: 'stderr', message: remaining });
    }

    this.isConnected = false;
    this.emit('disconnected');
  }

  private receiveEvent(event: DevEvent): void {
    // Buffer the event
    this.buffer.push(event);

    // Notify listeners
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        // Don't let listener errors break the client
        console.error('[DevEventClient] Listener error:', err);
      }
    }

    // Emit on EventEmitter for external consumers
    this.emit('event', event);
  }
}
