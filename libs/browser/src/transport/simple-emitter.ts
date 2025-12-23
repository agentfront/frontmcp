// file: libs/browser/src/transport/simple-emitter.ts
/**
 * Simple EventEmitter implementation for browser environments.
 *
 * This provides a minimal EventEmitter that works in browsers without
 * requiring Node.js dependencies. It implements the MinimalEventEmitter
 * interface for use with browser MCP transports.
 */

import type { MinimalEventEmitter } from './transport.interface';

/**
 * Simple EventEmitter implementation for browsers.
 *
 * @example
 * ```typescript
 * const emitter = createSimpleEmitter();
 *
 * emitter.on('message', (data) => console.log(data));
 * emitter.emit('message', { text: 'hello' });
 * ```
 */
export class SimpleEmitter implements MinimalEventEmitter {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: string, listener: (...args: unknown[]) => void): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return this;
  }

  off(event: string, listener: (...args: unknown[]) => void): this {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) {
      return false;
    }
    for (const listener of set) {
      try {
        listener(...args);
      } catch (error) {
        // Emit error event if available, otherwise ignore
        if (event !== 'error' && this.listeners.has('error')) {
          this.emit('error', error);
        }
      }
    }
    return true;
  }

  once(event: string, listener: (...args: unknown[]) => void): this {
    const onceWrapper = (...args: unknown[]) => {
      this.off(event, onceWrapper);
      listener(...args);
    };
    return this.on(event, onceWrapper);
  }

  removeAllListeners(event?: string): this {
    if (event === undefined) {
      this.listeners.clear();
    } else {
      this.listeners.delete(event);
    }
    return this;
  }

  /**
   * Get the number of listeners for an event.
   */
  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /**
   * Get all event names that have listeners.
   */
  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }
}

/**
 * Create a new simple EventEmitter instance.
 *
 * @returns A new SimpleEmitter instance
 *
 * @example
 * ```typescript
 * import { createSimpleEmitter, EventTransportAdapter } from '@frontmcp/browser';
 *
 * const emitter = createSimpleEmitter();
 * const transport = new EventTransportAdapter(emitter);
 * ```
 */
export function createSimpleEmitter(): SimpleEmitter {
  return new SimpleEmitter();
}
