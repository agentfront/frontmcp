// file: libs/browser/src/web-components/frontmcp-element.ts
/**
 * FrontMCP Custom Element
 *
 * Web Components wrapper for FrontMCP browser integration.
 * Provides Shadow DOM encapsulation and attribute-based configuration.
 */

import type { BrowserMcpServer } from '../server';
import type { BrowserScope } from '../scope';

/**
 * Custom element lifecycle callback types
 */
export interface ElementLifecycleCallbacks {
  onConnected?: (this: FrontMcpElement) => void;
  onDisconnected?: (this: FrontMcpElement) => void;
  onAttributeChanged?: (this: FrontMcpElement, name: string, oldValue: string | null, newValue: string | null) => void;
  onAdopted?: (this: FrontMcpElement) => void;
}

/**
 * FrontMCP element configuration
 */
export interface FrontMcpElementConfig {
  /** Element tag name (must contain hyphen) */
  tagName: string;
  /** Template HTML or function returning HTML */
  template?: string | (() => string);
  /** Styles to apply in Shadow DOM */
  styles?: string | string[];
  /** Whether to use Shadow DOM */
  useShadow?: boolean;
  /** Shadow DOM mode */
  shadowMode?: 'open' | 'closed';
  /** Observed attributes */
  observedAttributes?: string[];
  /** Lifecycle callbacks */
  callbacks?: ElementLifecycleCallbacks;
  /** Initial properties */
  properties?: Record<string, unknown>;
}

/**
 * FrontMCP element instance interface
 */
export interface FrontMcpElement extends HTMLElement {
  /** Access the MCP server */
  readonly mcpServer: BrowserMcpServer | null;
  /** Access the browser scope */
  readonly scope: BrowserScope | null;
  /** Set the MCP server */
  setMcpServer: (server: BrowserMcpServer) => void;
  /** Set the browser scope */
  setScope: (scope: BrowserScope) => void;
  /** Get a property value */
  getProperty: <T>(name: string) => T | undefined;
  /** Set a property value */
  setProperty: (name: string, value: unknown) => void;
  /** Render the element */
  render: () => void;
}

/**
 * Create a FrontMCP custom element class
 *
 * @example Basic usage
 * ```typescript
 * const MyElement = createFrontMcpElement({
 *   tagName: 'my-mcp-widget',
 *   template: `
 *     <div class="widget">
 *       <slot></slot>
 *     </div>
 *   `,
 *   styles: `
 *     :host {
 *       display: block;
 *     }
 *     .widget {
 *       padding: 16px;
 *       border: 1px solid #ccc;
 *     }
 *   `,
 * });
 *
 * customElements.define('my-mcp-widget', MyElement);
 * ```
 *
 * @example With MCP integration
 * ```typescript
 * const ToolButton = createFrontMcpElement({
 *   tagName: 'mcp-tool-button',
 *   observedAttributes: ['tool-name', 'label'],
 *   template() {
 *     return `<button class="tool-btn"><slot></slot></button>`;
 *   },
 *   callbacks: {
 *     onConnected() {
 *       this.shadowRoot?.querySelector('button')?.addEventListener('click', () => {
 *         const toolName = this.getAttribute('tool-name');
 *         this.scope?.tools.call(toolName, {});
 *       });
 *     },
 *   },
 * });
 * ```
 */
export function createFrontMcpElement(config: FrontMcpElementConfig): typeof HTMLElement & { new (): FrontMcpElement } {
  const {
    template = '',
    styles = '',
    useShadow = true,
    shadowMode = 'open',
    observedAttributes = [],
    callbacks = {},
    properties = {},
  } = config;

  class FrontMcpElementClass extends HTMLElement implements FrontMcpElement {
    static get observedAttributes() {
      return observedAttributes;
    }

    private _mcpServer: BrowserMcpServer | null = null;
    private _scope: BrowserScope | null = null;
    private _properties: Record<string, unknown> = { ...properties };
    private _shadowRoot: ShadowRoot | null = null;

    constructor() {
      super();

      if (useShadow) {
        this._shadowRoot = this.attachShadow({ mode: shadowMode });
      }
    }

    get mcpServer(): BrowserMcpServer | null {
      return this._mcpServer;
    }

    get scope(): BrowserScope | null {
      return this._scope;
    }

    setMcpServer(server: BrowserMcpServer): void {
      this._mcpServer = server;
      this.render();
    }

    setScope(scope: BrowserScope): void {
      this._scope = scope;
      this.render();
    }

    getProperty<T>(name: string): T | undefined {
      return this._properties[name] as T | undefined;
    }

    setProperty(name: string, value: unknown): void {
      this._properties[name] = value;
      this.render();
    }

    render(): void {
      const target = this._shadowRoot ?? this;

      // Get template content
      const templateContent = typeof template === 'function' ? template.call(this) : template;

      // Build styles
      const styleContent = Array.isArray(styles) ? styles.join('\n') : styles;

      // Render
      if (useShadow) {
        target.innerHTML = `
          ${styleContent ? `<style>${styleContent}</style>` : ''}
          ${templateContent}
        `;
      } else {
        target.innerHTML = templateContent;
      }
    }

    connectedCallback(): void {
      this.render();
      callbacks.onConnected?.call(this);
    }

    disconnectedCallback(): void {
      callbacks.onDisconnected?.call(this);
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
      callbacks.onAttributeChanged?.call(this, name, oldValue, newValue);
      this.render();
    }

    adoptedCallback(): void {
      callbacks.onAdopted?.call(this);
    }
  }

  return FrontMcpElementClass as typeof HTMLElement & { new (): FrontMcpElement };
}

/**
 * Define a custom element with FrontMCP integration
 *
 * @example
 * ```typescript
 * defineFrontMcpElement({
 *   tagName: 'mcp-status',
 *   template: '<span class="status"></span>',
 *   styles: '.status { color: green; }',
 *   callbacks: {
 *     onConnected() {
 *       const span = this.shadowRoot?.querySelector('.status');
 *       if (span && this.mcpServer) {
 *         span.textContent = this.mcpServer.isConnected ? 'Connected' : 'Disconnected';
 *       }
 *     },
 *   },
 * });
 *
 * // Use in HTML: <mcp-status></mcp-status>
 * ```
 */
export function defineFrontMcpElement(config: FrontMcpElementConfig): typeof HTMLElement {
  const ElementClass = createFrontMcpElement(config);
  customElements.define(config.tagName, ElementClass);
  return ElementClass;
}

/**
 * Check if a custom element is defined
 */
export function isElementDefined(tagName: string): boolean {
  return customElements.get(tagName) !== undefined;
}

/**
 * Wait for a custom element to be defined
 */
export function whenElementDefined(tagName: string): Promise<CustomElementConstructor> {
  return customElements.whenDefined(tagName);
}

/**
 * Create a reactive property descriptor for custom elements
 */
export function reactiveProperty<T>(
  initialValue: T,
  onChange?: (newValue: T, oldValue: T) => void,
): PropertyDescriptor {
  let value = initialValue;

  return {
    get() {
      return value;
    },
    set(newValue: T) {
      const oldValue = value;
      value = newValue;
      if (onChange && oldValue !== newValue) {
        onChange.call(this, newValue, oldValue);
      }
    },
    enumerable: true,
    configurable: true,
  };
}

/**
 * Decorator for observed attributes
 */
export function observeAttribute(attributeName: string) {
  return function (target: HTMLElement, propertyKey: string, descriptor?: PropertyDescriptor): PropertyDescriptor {
    const getter = function (this: HTMLElement): string | null {
      return this.getAttribute(attributeName);
    };

    const setter = function (this: HTMLElement, value: string | null): void {
      if (value === null) {
        this.removeAttribute(attributeName);
      } else {
        this.setAttribute(attributeName, value);
      }
    };

    return {
      get: getter,
      set: setter,
      enumerable: true,
      configurable: true,
    };
  };
}

/**
 * Helper to connect a custom element to FrontMCP
 */
export function connectToFrontMcp(element: FrontMcpElement, server: BrowserMcpServer, scope?: BrowserScope): void {
  element.setMcpServer(server);
  if (scope) {
    element.setScope(scope);
  }
}

/**
 * Creates the built-in FrontMCP status element class.
 *
 * This is a factory function that returns the element class when called,
 * allowing for better tree-shaking. The element is not created until
 * you call this function.
 *
 * @example
 * ```typescript
 * import { createFrontMcpStatusElement, connectToFrontMcp } from '@frontmcp/browser';
 *
 * // Create and define the element
 * const FrontMcpStatusElement = createFrontMcpStatusElement();
 * customElements.define('frontmcp-status', FrontMcpStatusElement);
 *
 * // Use in HTML
 * // <frontmcp-status show-details="true"></frontmcp-status>
 *
 * // Connect to MCP server
 * const element = document.querySelector('frontmcp-status') as FrontMcpElement;
 * connectToFrontMcp(element, mcpServer);
 * ```
 */
export function createFrontMcpStatusElement(): typeof HTMLElement & { new (): FrontMcpElement } {
  return createFrontMcpElement({
    tagName: 'frontmcp-status',
    observedAttributes: ['show-details'],
    template: `
      <div class="status-container">
        <span class="indicator"></span>
        <span class="label">Disconnected</span>
        <span class="details"></span>
      </div>
    `,
    styles: `
      :host {
        display: inline-flex;
        align-items: center;
        font-family: system-ui, sans-serif;
        font-size: 14px;
      }
      .status-container {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: #ef4444;
      }
      .indicator.connected {
        background-color: #22c55e;
      }
      .label {
        color: #374151;
      }
      .details {
        color: #6b7280;
        font-size: 12px;
      }
    `,
    callbacks: {
      onConnected() {
        this.render();
      },
      onAttributeChanged() {
        this.render();
      },
    },
  });
}
