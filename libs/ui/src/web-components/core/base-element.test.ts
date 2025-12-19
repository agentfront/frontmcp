/**
 * @file base-element.test.ts
 * @description Tests for FmcpElement base class.
 *
 * Uses manual DOM mocking to avoid jsdom dependency.
 */

import { z } from 'zod';
import { FmcpElement, type FmcpElementConfig, type FmcpRenderEventDetail } from './base-element';
import { getObservedAttributesFromSchema } from './attribute-parser';

// Test schema
const TestOptionsSchema = z.object({
  variant: z.enum(['primary', 'secondary']).optional(),
  size: z.enum(['sm', 'md', 'lg']).optional(),
  disabled: z.boolean().optional(),
  fullWidth: z.boolean().optional(),
});

type TestOptions = z.infer<typeof TestOptionsSchema>;

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
 * Mock HTMLElement for testing FmcpElement
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
    // Mock first element child
    if (value.includes('<div') || value.includes('<button')) {
      this.firstElementChild = { tagName: value.includes('<button') ? 'BUTTON' : 'DIV' } as unknown as Element;
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

    // Trigger attributeChangedCallback if element has it
    if (
      typeof (
        this as unknown as { attributeChangedCallback: (name: string, oldVal: string | null, newVal: string) => void }
      ).attributeChangedCallback === 'function'
    ) {
      (
        this as unknown as { attributeChangedCallback: (name: string, oldVal: string | null, newVal: string) => void }
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
}

// Set up global mocks
const originalGlobalCustomEvent = global.CustomEvent;
const originalGlobalHTMLElement = global.HTMLElement;
const originalQueueMicrotask = global.queueMicrotask;

beforeAll(() => {
  // Mock CustomEvent
  (global as { CustomEvent: typeof MockCustomEvent }).CustomEvent = MockCustomEvent as unknown as typeof CustomEvent;

  // Mock HTMLElement
  (global as { HTMLElement: typeof MockHTMLElement }).HTMLElement = MockHTMLElement as unknown as typeof HTMLElement;

  // Ensure queueMicrotask exists
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
  global.queueMicrotask = originalQueueMicrotask;
});

/**
 * Concrete test implementation of FmcpElement
 */
class TestElement extends FmcpElement<TestOptions> {
  protected readonly config: FmcpElementConfig<TestOptions> = {
    name: 'test',
    schema: TestOptionsSchema,
    defaults: {
      variant: 'primary',
      size: 'md',
    },
  };

  static get observedAttributes(): string[] {
    return getObservedAttributesFromSchema(TestOptionsSchema);
  }

  protected renderHtml(options: TestOptions, content: string): string {
    const classes = [
      `test-${options.variant || 'primary'}`,
      `size-${options.size || 'md'}`,
      options.disabled ? 'disabled' : '',
      options.fullWidth ? 'full-width' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return `<div class="${classes}">${content}</div>`;
  }
}

/**
 * Helper to create and connect a test element
 */
function createTestElement(attributes: Record<string, string> = {}, content = ''): TestElement {
  const el = new TestElement();

  // Set initial content
  (el as unknown as { innerHTML: string }).innerHTML = content;

  // Set attributes before connecting
  for (const [name, value] of Object.entries(attributes)) {
    el.setAttribute(name, value);
  }

  // Simulate connecting to DOM
  el.connectedCallback();

  return el;
}

describe('FmcpElement Base Class', () => {
  describe('connectedCallback', () => {
    it('should render on connect', () => {
      const el = createTestElement({}, 'Test Content');

      expect(el.innerHTML).toContain('<div');
      expect(el.innerHTML).toContain('Test Content');
    });

    it('should apply default options', () => {
      const el = createTestElement();

      expect(el.innerHTML).toContain('test-primary');
      expect(el.innerHTML).toContain('size-md');
    });

    it('should capture initial content', () => {
      const el = createTestElement({}, 'My Content');

      expect(el.innerHTML).toContain('My Content');
    });
  });

  describe('attribute parsing', () => {
    it('should parse string attributes', () => {
      const el = createTestElement({ variant: 'secondary' });

      expect(el.innerHTML).toContain('test-secondary');
    });

    it('should parse boolean presence attributes', () => {
      const el = createTestElement({ disabled: '' });

      expect(el.innerHTML).toContain('disabled');
    });

    it('should parse kebab-case to camelCase', () => {
      const el = createTestElement({ 'full-width': '' });

      expect(el.innerHTML).toContain('full-width');
    });
  });

  describe('attributeChangedCallback', () => {
    it('should re-render on attribute change', async () => {
      const el = createTestElement({ variant: 'primary' });

      expect(el.innerHTML).toContain('test-primary');

      el.setAttribute('variant', 'secondary');

      // Wait for microtask to complete
      await Promise.resolve();
      await Promise.resolve();

      expect(el.innerHTML).toContain('test-secondary');
    });

    it('should not re-render if value unchanged', async () => {
      const el = createTestElement({ variant: 'primary' });

      const originalHtml = el.innerHTML;

      // Set to same value (manually trigger callback with same value)
      el.attributeChangedCallback('variant', 'primary', 'primary');

      await Promise.resolve();

      expect(el.innerHTML).toBe(originalHtml);
    });
  });

  describe('property setters', () => {
    it('should set options property', async () => {
      const el = createTestElement();

      el.options = { variant: 'secondary', size: 'lg' };

      await Promise.resolve();
      await Promise.resolve();

      expect(el.innerHTML).toContain('test-secondary');
      expect(el.innerHTML).toContain('size-lg');
    });

    it('should get options property', () => {
      const el = createTestElement({ variant: 'secondary' });

      const options = el.options;
      expect(options.variant).toBe('secondary');
    });

    it('should merge options with existing', async () => {
      const el = createTestElement({ variant: 'primary' });

      el.options = { size: 'lg' };

      await Promise.resolve();
      await Promise.resolve();

      // Should have both variant from attribute and size from property
      expect(el.innerHTML).toContain('test-primary');
      expect(el.innerHTML).toContain('size-lg');
    });
  });

  describe('validation', () => {
    it('should render error box for invalid variant', () => {
      const el = createTestElement({ variant: 'invalid' });

      expect(el.innerHTML).toContain('validation-error');
      expect(el.innerHTML).toContain('data-component="test"');
    });

    it('should render error box for invalid size', () => {
      const el = createTestElement({ size: 'huge' });

      expect(el.innerHTML).toContain('validation-error');
      expect(el.innerHTML).toContain('data-component="test"');
    });
  });

  describe('events', () => {
    it('should dispatch fmcp:render event after render', async () => {
      const el = new TestElement();

      let renderDetail: FmcpRenderEventDetail<TestOptions> | undefined;
      el.addEventListener('fmcp:render', ((e: MockCustomEvent<FmcpRenderEventDetail<TestOptions>>) => {
        renderDetail = e.detail;
      }) as EventListener);

      el.connectedCallback();

      expect(renderDetail).toBeDefined();
      expect(renderDetail?.options.variant).toBe('primary');
    });
  });

  describe('public API', () => {
    it('should refresh on demand', () => {
      const el = createTestElement();

      // Modify internal options directly
      el.options = { variant: 'secondary' };
      el.refresh();

      expect(el.innerHTML).toContain('test-secondary');
    });

    it('should return inner element', () => {
      const el = createTestElement({}, 'Content');

      const inner = el.getInnerElement<HTMLDivElement>();
      expect(inner).not.toBeNull();
      expect(inner?.tagName).toBe('DIV');
    });

    it('should update content via setContent', async () => {
      const el = createTestElement({}, 'Original');

      el.setContent('Updated');

      await Promise.resolve();
      await Promise.resolve();

      expect(el.innerHTML).toContain('Updated');
    });
  });

  describe('disconnectedCallback', () => {
    it('should not render when disconnected', async () => {
      const el = createTestElement();

      const originalHtml = el.innerHTML;

      // Disconnect
      el.disconnectedCallback();

      // Try to trigger re-render
      el.options = { variant: 'secondary' };

      await Promise.resolve();
      await Promise.resolve();

      // Should not have re-rendered
      expect(el.innerHTML).toBe(originalHtml);
    });
  });

  describe('observedAttributes', () => {
    it('should return observed attributes from schema', () => {
      const attrs = TestElement.observedAttributes;

      expect(attrs).toContain('variant');
      expect(attrs).toContain('size');
      expect(attrs).toContain('disabled');
      expect(attrs).toContain('full-width');
      // Common attrs
      expect(attrs).toContain('class');
      expect(attrs).toContain('id');
    });
  });
});
