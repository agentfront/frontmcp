/**
 * @file setup.ts
 * @description Jest setup file for web component tests.
 *
 * Sets up DOM mocks before any test modules are imported.
 */

/**
 * Mock CustomEvent for Node.js environment
 */
class MockCustomEvent<T = unknown> {
  type: string;
  detail: T;
  bubbles: boolean;

  constructor(type: string, init?: { bubbles?: boolean; detail?: T }) {
    this.type = type;
    this.detail = init?.detail as T;
    this.bubbles = init?.bubbles ?? false;
  }
}

/**
 * Mock HTMLElement for testing
 */
class MockHTMLElement {
  private _attributes: Map<string, string> = new Map();
  private _innerHTML = '';
  private _eventListeners: Map<string, ((e: unknown) => void)[]> = new Map();
  firstElementChild: { tagName: string } | null = null;

  get innerHTML(): string {
    return this._innerHTML;
  }

  set innerHTML(value: string) {
    this._innerHTML = value;
    if (value.includes('<div') || value.includes('<button') || value.includes('<span')) {
      const tagMatch = value.match(/<(div|button|span|input|select)/);
      this.firstElementChild = { tagName: tagMatch?.[1]?.toUpperCase() || 'DIV' };
    }
  }

  get attributes(): { [Symbol.iterator]: () => Iterator<{ name: string; value: string }> } {
    const attrs: { name: string; value: string }[] = [];
    this._attributes.forEach((value, name) => {
      attrs.push({ name, value });
    });
    return {
      [Symbol.iterator]: () => attrs[Symbol.iterator](),
    };
  }

  getAttribute(name: string): string | null {
    return this._attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    const oldValue = this._attributes.get(name);
    this._attributes.set(name, value);

    if (
      typeof (this as { attributeChangedCallback?: (n: string, o: string | null, v: string) => void })
        .attributeChangedCallback === 'function'
    ) {
      (this as { attributeChangedCallback: (n: string, o: string | null, v: string) => void }).attributeChangedCallback(
        name,
        oldValue ?? null,
        value,
      );
    }
  }

  removeAttribute(name: string): void {
    this._attributes.delete(name);
  }

  addEventListener(type: string, listener: (e: unknown) => void): void {
    const listeners = this._eventListeners.get(type) || [];
    listeners.push(listener);
    this._eventListeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (e: unknown) => void): void {
    const listeners = this._eventListeners.get(type) || [];
    const index = listeners.indexOf(listener);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
  }

  dispatchEvent(event: MockCustomEvent): boolean {
    const listeners = this._eventListeners.get(event.type) || [];
    listeners.forEach((listener) => listener(event));
    return true;
  }

  querySelector(_selector: string): null {
    return null;
  }
}

// Set up globals before any modules load
(global as unknown as { CustomEvent: typeof MockCustomEvent }).CustomEvent =
  MockCustomEvent as unknown as typeof CustomEvent;
(global as unknown as { HTMLElement: typeof MockHTMLElement }).HTMLElement =
  MockHTMLElement as unknown as typeof HTMLElement;

// Mock customElements registry
const registry = new Map<string, unknown>();
(
  global as { customElements: { define: (n: string, c: unknown) => void; get: (n: string) => unknown } }
).customElements = {
  define: (name: string, constructor: unknown) => {
    if (!registry.has(name)) {
      registry.set(name, constructor);
    }
  },
  get: (name: string) => registry.get(name),
};

// Ensure queueMicrotask exists
if (typeof global.queueMicrotask !== 'function') {
  global.queueMicrotask = (callback: () => void) => {
    Promise.resolve().then(callback);
  };
}

export {};
