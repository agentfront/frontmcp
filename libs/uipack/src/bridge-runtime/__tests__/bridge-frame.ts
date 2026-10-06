/**
 * Test harness: runs the generated bridge IIFE inside a jsdom `<iframe>` so the
 * ext-apps adapter sees a parent window, and lets the test play the host.
 *
 * jsdom has no layout engine and no animation frames, so the harness stubs
 * `ResizeObserver`, `requestAnimationFrame`, `getBoundingClientRect` and
 * `body.scrollHeight`. Frames are flushed explicitly, which lets a test run the
 * first size report before the host has answered `ui/initialize`.
 *
 * Must be used from a spec with the `@jest-environment jsdom` docblock.
 */
import { generateBridgeIIFE } from '../iife-generator';

export const HOST_ORIGIN = 'https://host.example';

export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface BridgeGlobal {
  readonly initialized: boolean;
  setSize(size: { height?: number; width?: number; aspectRatio?: number | string }): Promise<unknown>;
  onContextChange(callback: (changes: Record<string, unknown>) => void): () => void;
  getTheme(): string;
  getHostContext(): Record<string, unknown>;
  getToolOutput(): unknown;
  getStructuredContent(): unknown;
  onToolResult(callback: (result: unknown) => void): () => void;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Box returned by the stubbed `getBoundingClientRect` for one element. */
export interface StubBox {
  top: number;
  height: number;
  width?: number;
}

/**
 * Stubbed layout. `html` receives the `style.height` the element has at the
 * moment it is measured, so a test can tell the measurement apart from the
 * height the document has while it fills the viewport.
 */
export interface StubLayout {
  html: (inlineHeight: string) => StubBox;
  body: StubBox;
  bodyScrollHeight: number;
  root?: StubBox;
}

export interface FrameWindow extends Window {
  eval(code: string): unknown;
  HTMLElement: typeof HTMLElement;
  MessageEvent: typeof MessageEvent;
  ResizeObserver?: unknown;
  __mcpAppsEnabled?: boolean;
  __mcpWidgetSizing?: Record<string, unknown>;
  FrontMcpBridge?: BridgeGlobal;
}

export interface BridgeFrameOptions {
  /** Value injected as `window.__mcpWidgetSizing`; omit to leave it unset. */
  sizing?: Record<string, unknown>;
  layout?: StubLayout;
  /** Markup placed in the frame's `<body>` before the bridge runs. */
  bodyHtml?: string;
  /** Markup appended to the frame's `<head>` before the bridge runs. */
  headHtml?: string;
  minify?: boolean;
  /** Runs on the frame window just before the bridge IIFE, e.g. to define `window.openai`. */
  beforeBridge?: (win: FrameWindow) => void;
}

export interface BridgeFrame {
  readonly win: FrameWindow;
  readonly doc: Document;
  readonly bridge: BridgeGlobal;
  /** Every JSON-RPC message the widget posted to its parent, in order. */
  readonly posted: JsonRpcMessage[];
  /** Elements passed to `ResizeObserver.observe`. */
  readonly observed: Element[];
  layout: StubLayout;
  /** Run the animation-frame callbacks queued so far. */
  flushFrames(): void;
  /** Invoke every ResizeObserver callback, as a layout change would. */
  triggerResize(): void;
  /** Let pending timers and promise callbacks run. */
  settle(): Promise<void>;
  /** Requests the widget posted for `method`. */
  requests(method: string): JsonRpcMessage[];
  /** Notifications (messages without an id) the widget posted for `method`. */
  notifications(method: string): JsonRpcMessage[];
  /** Answer the latest `method` request with a result. */
  answer(method: string, result: unknown): Promise<void>;
  /** Answer the latest `method` request with a JSON-RPC error. */
  fail(method: string, message?: string): Promise<void>;
  /** Send a host notification. */
  notify(method: string, params: Record<string, unknown>): Promise<void>;
  destroy(): void;
}

const DEFAULT_LAYOUT: StubLayout = {
  html: () => ({ top: 0, height: 120, width: 400 }),
  body: { top: 0, height: 120, width: 400 },
  bodyScrollHeight: 120,
};

/** Create a frame, stub layout primitives, and run the bridge IIFE in it. */
export function createBridgeFrame(options: BridgeFrameOptions = {}): BridgeFrame {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const frameWindow = iframe.contentWindow as unknown as FrameWindow | null;
  if (!frameWindow) throw new Error('jsdom did not create an iframe window');
  const win: FrameWindow = frameWindow;
  const doc = win.document;

  const posted: JsonRpcMessage[] = [];
  const observed: Element[] = [];
  const observerCallbacks: Array<() => void> = [];
  let frames: Array<() => void> = [];

  const postSpy = jest.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
    posted.push(message as JsonRpcMessage);
  });

  if (options.headHtml) doc.head.insertAdjacentHTML('beforeend', options.headHtml);
  doc.body.innerHTML = options.bodyHtml ?? '';

  const frame: BridgeFrame = {
    win,
    doc,
    get bridge(): BridgeGlobal {
      const bridge = win.FrontMcpBridge;
      if (!bridge) throw new Error('bridge IIFE did not expose window.FrontMcpBridge');
      return bridge;
    },
    posted,
    observed,
    layout: options.layout ?? DEFAULT_LAYOUT,
    flushFrames() {
      const queued = frames;
      frames = [];
      for (const cb of queued) cb();
    },
    triggerResize() {
      for (const cb of observerCallbacks) cb();
    },
    async settle() {
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
    requests(method: string) {
      return posted.filter((m) => m.method === method && typeof m.id === 'number');
    },
    notifications(method: string) {
      return posted.filter((m) => m.method === method && m.id === undefined);
    },
    async answer(method: string, result: unknown) {
      const request = latestRequest(method);
      dispatchFromHost({ jsonrpc: '2.0', id: request.id, result });
      await frame.settle();
    },
    async fail(method: string, message = 'Method not found') {
      const request = latestRequest(method);
      dispatchFromHost({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message } });
      await frame.settle();
    },
    async notify(method: string, params: Record<string, unknown>) {
      dispatchFromHost({ jsonrpc: '2.0', method, params });
      await frame.settle();
    },
    destroy() {
      postSpy.mockRestore();
      iframe.remove();
    },
  };

  function latestRequest(method: string): JsonRpcMessage {
    const all = frame.requests(method);
    const request = all[all.length - 1];
    if (!request) throw new Error(`the widget never sent a ${method} request`);
    return request;
  }

  function dispatchFromHost(data: JsonRpcMessage): void {
    win.dispatchEvent(new win.MessageEvent('message', { data, origin: HOST_ORIGIN }));
  }

  win.__mcpAppsEnabled = true;
  if (options.sizing) win.__mcpWidgetSizing = options.sizing;
  win.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    frames.push(() => cb(0));
    return frames.length;
  };
  win.ResizeObserver = class {
    constructor(cb: () => void) {
      observerCallbacks.push(() => cb());
    }
    observe(el: Element): void {
      observed.push(el);
    }
    disconnect(): void {
      observerCallbacks.length = 0;
    }
  };
  win.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    const layout = frame.layout;
    let box: StubBox;
    if (this === doc.documentElement) box = layout.html(doc.documentElement.style.height);
    else if (this === doc.body) box = layout.body;
    else if (this.id === 'root' && layout.root) box = layout.root;
    else box = { top: 0, height: 0, width: 0 };
    const width = box.width ?? 400;
    return {
      x: 0,
      y: box.top,
      top: box.top,
      left: 0,
      right: width,
      bottom: box.top + box.height,
      width,
      height: box.height,
      toJSON: () => ({}),
    } as DOMRect;
  };
  Object.defineProperty(doc.body, 'scrollHeight', {
    configurable: true,
    get: () => frame.layout.bodyScrollHeight,
  });

  options.beforeBridge?.(win);
  win.eval(generateBridgeIIFE({ minify: options.minify ?? true }));
  return frame;
}
