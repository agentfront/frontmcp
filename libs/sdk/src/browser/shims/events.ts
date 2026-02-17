/**
 * Browser shim for node:events
 *
 * Provides a minimal EventEmitter implementation for browser environments.
 */

type Listener = (...args: unknown[]) => void;

export class EventEmitter {
  private _events: Map<string | symbol, Listener[]> = new Map();
  private _maxListeners = 10;

  on(event: string | symbol, listener: Listener): this {
    const listeners = this._events.get(event) || [];
    listeners.push(listener);
    this._events.set(event, listeners);
    return this;
  }

  addListener(event: string | symbol, listener: Listener): this {
    return this.on(event, listener);
  }

  once(event: string | symbol, listener: Listener): this {
    const wrapper: Listener = (...args) => {
      this.off(event, wrapper);
      listener(...args);
    };
    return this.on(event, wrapper);
  }

  off(event: string | symbol, listener: Listener): this {
    const listeners = this._events.get(event);
    if (listeners) {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
      if (listeners.length === 0) this._events.delete(event);
    }
    return this;
  }

  removeListener(event: string | symbol, listener: Listener): this {
    return this.off(event, listener);
  }

  removeAllListeners(event?: string | symbol): this {
    if (event !== undefined) {
      this._events.delete(event);
    } else {
      this._events.clear();
    }
    return this;
  }

  emit(event: string | symbol, ...args: unknown[]): boolean {
    const listeners = this._events.get(event);
    if (!listeners || listeners.length === 0) return false;
    for (const listener of [...listeners]) {
      listener(...args);
    }
    return true;
  }

  listenerCount(event: string | symbol): number {
    return this._events.get(event)?.length || 0;
  }

  listeners(event: string | symbol): Listener[] {
    return [...(this._events.get(event) || [])];
  }

  setMaxListeners(n: number): this {
    this._maxListeners = n;
    return this;
  }

  getMaxListeners(): number {
    return this._maxListeners;
  }

  eventNames(): (string | symbol)[] {
    return [...this._events.keys()];
  }
}

export default EventEmitter;
