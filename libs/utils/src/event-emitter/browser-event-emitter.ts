/**
 * Lightweight browser polyfill for Node's EventEmitter.
 *
 * Implements the subset used by the FrontMCP codebase:
 * emit, on, off, removeAllListeners, setMaxListeners, listenerCount.
 */

type Listener = Function;

export class EventEmitter {
  private events = new Map<string | symbol, Listener[]>();

  emit(event: string | symbol, ...args: unknown[]): boolean {
    const handlers = this.events.get(event);
    if (!handlers || handlers.length === 0) return false;
    for (const handler of [...handlers]) {
      handler(...args);
    }
    return true;
  }

  on(event: string | symbol, handler: Listener): this {
    const list = this.events.get(event) ?? [];
    list.push(handler);
    this.events.set(event, list);
    return this;
  }

  off(event: string | symbol, handler: Listener): this {
    const list = this.events.get(event);
    if (list) {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    }
    return this;
  }

  addListener(event: string | symbol, handler: Listener): this {
    return this.on(event, handler);
  }

  removeListener(event: string | symbol, handler: Listener): this {
    return this.off(event, handler);
  }

  removeAllListeners(event?: string | symbol): this {
    if (event !== undefined) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
    return this;
  }

  setMaxListeners(_n: number): this {
    return this; // no-op in browser
  }

  listenerCount(event: string | symbol): number {
    return this.events.get(event)?.length ?? 0;
  }
}
