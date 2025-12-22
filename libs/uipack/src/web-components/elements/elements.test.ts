/**
 * @file elements.test.ts
 * @description Tests for FrontMCP Web Component elements.
 *
 * Uses manual DOM mocking to avoid jsdom dependency.
 * Tests focus on the component logic and HTML rendering.
 */

import { FmcpButton } from './fmcp-button';
import { FmcpCard } from './fmcp-card';
import { FmcpAlert } from './fmcp-alert';
import { FmcpBadge } from './fmcp-badge';
import { FmcpInput } from './fmcp-input';
import { FmcpSelect } from './fmcp-select';
import {
  registerFmcpButton,
  registerFmcpCard,
  registerFmcpAlert,
  registerFmcpBadge,
  registerFmcpInput,
  registerFmcpSelect,
} from './index';

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
  firstElementChild: Element | null = null;

  get innerHTML(): string {
    return this._innerHTML;
  }

  set innerHTML(value: string) {
    this._innerHTML = value;
    if (value.includes('<div') || value.includes('<button') || value.includes('<span')) {
      const tagMatch = value.match(/<(div|button|span|input|select)/);
      this.firstElementChild = { tagName: tagMatch?.[1]?.toUpperCase() || 'DIV' } as unknown as Element;
    }
  }

  get attributes(): NamedNodeMap {
    const attrs: Attr[] = [];
    this._attributes.forEach((value, name) => {
      attrs.push({ name, value } as unknown as Attr);
    });
    return {
      [Symbol.iterator]: () => attrs[Symbol.iterator](),
      length: attrs.length,
    } as unknown as NamedNodeMap;
  }

  getAttribute(name: string): string | null {
    return this._attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    const oldValue = this._attributes.get(name);
    this._attributes.set(name, value);

    if (
      typeof (this as unknown as { attributeChangedCallback: (n: string, o: string | null, v: string) => void })
        .attributeChangedCallback === 'function'
    ) {
      (
        this as unknown as { attributeChangedCallback: (n: string, o: string | null, v: string) => void }
      ).attributeChangedCallback(name, oldValue ?? null, value);
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

  // Mock methods that some elements use
  querySelector(_selector: string): Element | null {
    return null;
  }
}

// Set up global mocks
const originalGlobalCustomEvent = global.CustomEvent;
const originalGlobalHTMLElement = global.HTMLElement;
const originalCustomElements = global.customElements;

beforeAll(() => {
  (global as { CustomEvent: typeof MockCustomEvent }).CustomEvent = MockCustomEvent as unknown as typeof CustomEvent;
  (global as { HTMLElement: typeof MockHTMLElement }).HTMLElement = MockHTMLElement as unknown as typeof HTMLElement;

  // Mock customElements registry
  const registry = new Map<string, CustomElementConstructor>();
  (global as { customElements: CustomElementRegistry }).customElements = {
    define: (name: string, constructor: CustomElementConstructor) => {
      if (!registry.has(name)) {
        registry.set(name, constructor);
      }
    },
    get: (name: string) => registry.get(name),
  } as unknown as CustomElementRegistry;

  if (typeof global.queueMicrotask !== 'function') {
    global.queueMicrotask = (callback: () => void) => {
      Promise.resolve().then(callback);
    };
  }
});

afterAll(() => {
  if (originalGlobalCustomEvent) {
    (global as { CustomEvent: typeof CustomEvent }).CustomEvent = originalGlobalCustomEvent;
  }
  if (originalGlobalHTMLElement) {
    (global as { HTMLElement: typeof HTMLElement }).HTMLElement = originalGlobalHTMLElement;
  }
  if (originalCustomElements) {
    (global as { customElements: CustomElementRegistry }).customElements = originalCustomElements;
  }
});

/**
 * Helper to create and connect an element
 */
function createElement<
  T extends { connectedCallback(): void; innerHTML: string; setAttribute(n: string, v: string): void },
>(ElementClass: new () => T, attributes: Record<string, string> = {}, content = ''): T {
  const el = new ElementClass();
  (el as unknown as { innerHTML: string }).innerHTML = content;

  for (const [name, value] of Object.entries(attributes)) {
    el.setAttribute(name, value);
  }

  el.connectedCallback();
  return el;
}

describe('FmcpButton', () => {
  it('should render a button element', () => {
    const el = createElement(FmcpButton, {}, 'Click Me');
    expect(el.innerHTML).toContain('<button');
    expect(el.innerHTML).toContain('Click Me');
  });

  it('should apply variant attribute', () => {
    const el = createElement(FmcpButton, { variant: 'danger' }, 'Delete');
    expect(el.innerHTML).toContain('bg-danger');
  });

  it('should handle disabled attribute', () => {
    const el = createElement(FmcpButton, { disabled: '' });
    expect(el.innerHTML).toContain('disabled');
    expect(el.innerHTML).toContain('opacity-50');
  });

  it('should handle loading attribute', () => {
    const el = createElement(FmcpButton, { loading: 'true' });
    expect(el.innerHTML).toContain('animate-spin');
  });

  it('should support variant property setter', async () => {
    const el = createElement(FmcpButton);
    el.variant = 'secondary';
    await Promise.resolve();
    await Promise.resolve();
    expect(el.innerHTML).toContain('bg-secondary');
  });

  it('should support disabled property', async () => {
    const el = createElement(FmcpButton);
    el.disabled = true;
    await Promise.resolve();
    await Promise.resolve();
    expect(el.innerHTML).toContain('disabled');
  });

  it('should render error box for invalid options', () => {
    const el = createElement(FmcpButton, { variant: 'invalid-variant' });
    expect(el.innerHTML).toContain('validation-error');
  });
});

describe('FmcpCard', () => {
  it('should render a card element', () => {
    const el = createElement(FmcpCard, {}, 'Card Content');
    expect(el.innerHTML).toContain('Card Content');
    expect(el.innerHTML).toContain('rounded');
  });

  it('should apply card-title attribute', () => {
    const el = createElement(FmcpCard, { 'card-title': 'My Card' }, 'Content');
    expect(el.innerHTML).toContain('My Card');
  });

  it('should apply variant attribute', () => {
    const el = createElement(FmcpCard, { variant: 'elevated' });
    expect(el.innerHTML).toContain('shadow');
  });

  it('should support cardTitle property', async () => {
    const el = createElement(FmcpCard);
    el.cardTitle = 'Title via Property';
    await Promise.resolve();
    await Promise.resolve();
    expect(el.innerHTML).toContain('Title via Property');
  });

  it('should render error box for invalid options', () => {
    const el = createElement(FmcpCard, { variant: 'invalid-variant' });
    expect(el.innerHTML).toContain('validation-error');
  });
});

describe('FmcpAlert', () => {
  it('should render an alert element', () => {
    const el = createElement(FmcpAlert, {}, 'Alert Message');
    expect(el.innerHTML).toContain('Alert Message');
  });

  it('should apply variant attribute', () => {
    const el = createElement(FmcpAlert, { variant: 'success' }, 'Success!');
    expect(el.innerHTML).toContain('Success!');
  });

  it('should apply alert-title attribute', () => {
    const el = createElement(FmcpAlert, { 'alert-title': 'Warning', variant: 'warning' });
    expect(el.innerHTML).toContain('Warning');
  });

  it('should show icon by default', () => {
    const el = createElement(FmcpAlert, { variant: 'info' });
    expect(el.innerHTML).toContain('<svg');
  });

  it('should support alertTitle property', async () => {
    const el = createElement(FmcpAlert);
    el.alertTitle = 'Error Title';
    await Promise.resolve();
    await Promise.resolve();
    expect(el.innerHTML).toContain('Error Title');
  });

  it('should render error box for invalid options', () => {
    const el = createElement(FmcpAlert, { variant: 'invalid-variant' });
    expect(el.innerHTML).toContain('validation-error');
  });
});

describe('FmcpBadge', () => {
  it('should render a badge element', () => {
    const el = createElement(FmcpBadge, {}, 'New');
    expect(el.innerHTML).toContain('New');
    expect(el.innerHTML).toContain('<span');
  });

  it('should apply variant attribute', () => {
    const el = createElement(FmcpBadge, { variant: 'success' }, 'Active');
    expect(el.innerHTML).toContain('bg-success');
  });

  it('should support variant property', async () => {
    const el = createElement(FmcpBadge);
    el.variant = 'danger';
    await Promise.resolve();
    await Promise.resolve();
    expect(el.innerHTML).toContain('bg-danger');
  });

  it('should render error box for invalid options', () => {
    const el = createElement(FmcpBadge, { variant: 'invalid-variant' });
    expect(el.innerHTML).toContain('validation-error');
  });
});

describe('FmcpInput', () => {
  it('should render an input element', () => {
    const el = createElement(FmcpInput, { name: 'email' });
    expect(el.innerHTML).toContain('<input');
    expect(el.innerHTML).toContain('name="email"');
  });

  it('should apply type attribute', () => {
    const el = createElement(FmcpInput, { type: 'password', name: 'password' });
    expect(el.innerHTML).toContain('type="password"');
  });

  it('should apply label attribute', () => {
    const el = createElement(FmcpInput, { label: 'Email Address', name: 'email' });
    expect(el.innerHTML).toContain('Email Address');
  });

  it('should apply placeholder attribute', () => {
    const el = createElement(FmcpInput, { placeholder: 'Enter email', name: 'email' });
    expect(el.innerHTML).toContain('placeholder="Enter email"');
  });

  it('should handle required attribute', () => {
    const el = createElement(FmcpInput, { required: '', name: 'email' });
    expect(el.innerHTML).toContain('required');
  });

  it('should handle disabled attribute', () => {
    const el = createElement(FmcpInput, { disabled: '', name: 'email' });
    expect(el.innerHTML).toContain('disabled');
  });
});

describe('FmcpSelect', () => {
  it('should render a select element', () => {
    const el = createElement(FmcpSelect, { name: 'country' });
    expect(el.innerHTML).toContain('<select');
    expect(el.innerHTML).toContain('name="country"');
  });

  it('should apply label attribute', () => {
    const el = createElement(FmcpSelect, { label: 'Country', name: 'country' });
    expect(el.innerHTML).toContain('Country');
  });

  it('should support selectOptions property', async () => {
    const el = createElement(FmcpSelect, { name: 'country' });
    el.selectOptions = [
      { value: 'us', label: 'United States' },
      { value: 'uk', label: 'United Kingdom' },
    ];
    await Promise.resolve();
    await Promise.resolve();
    expect(el.innerHTML).toContain('United States');
    expect(el.innerHTML).toContain('United Kingdom');
    expect(el.innerHTML).toContain('value="us"');
    expect(el.innerHTML).toContain('value="uk"');
  });

  it('should handle required attribute', () => {
    const el = createElement(FmcpSelect, { required: '', name: 'country' });
    expect(el.innerHTML).toContain('required');
  });

  it('should handle disabled attribute', () => {
    const el = createElement(FmcpSelect, { disabled: '', name: 'country' });
    expect(el.innerHTML).toContain('disabled');
  });
});

describe('Registration', () => {
  it('should not throw when registering elements', () => {
    expect(() => {
      registerFmcpButton();
      registerFmcpCard();
      registerFmcpAlert();
      registerFmcpBadge();
      registerFmcpInput();
      registerFmcpSelect();
    }).not.toThrow();
  });

  it('should not re-register existing elements', () => {
    // First registration
    registerFmcpButton();
    // Second registration should not throw
    expect(() => registerFmcpButton()).not.toThrow();
  });

  it('should register elements to customElements', () => {
    registerFmcpButton();
    expect(customElements.get('fmcp-button')).toBeDefined();
  });
});
