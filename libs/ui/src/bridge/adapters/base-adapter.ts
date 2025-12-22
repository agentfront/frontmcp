/**
 * Base Platform Adapter
 *
 * Abstract base class for platform adapters with default implementations.
 * Extend this class to create custom adapters for new platforms.
 *
 * @packageDocumentation
 */

import type {
  PlatformAdapter,
  AdapterCapabilities,
  DisplayMode,
  UserAgentInfo,
  SafeAreaInsets,
  ViewportInfo,
  HostContext,
} from '../types';

/**
 * Default adapter capabilities (most features disabled).
 */
export const DEFAULT_CAPABILITIES: AdapterCapabilities = {
  canCallTools: false,
  canSendMessages: false,
  canOpenLinks: false,
  canPersistState: true, // localStorage fallback
  hasNetworkAccess: true,
  supportsDisplayModes: false,
  supportsTheme: true,
};

/**
 * Default safe area insets (no insets).
 */
export const DEFAULT_SAFE_AREA: SafeAreaInsets = {
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
};

/**
 * Abstract base class for platform adapters.
 * Provides default implementations that can be overridden.
 */
export abstract class BaseAdapter implements PlatformAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly priority: number;

  protected _capabilities: AdapterCapabilities = { ...DEFAULT_CAPABILITIES };
  protected _hostContext: HostContext;
  protected _widgetState: Record<string, unknown> = {};
  protected _toolInput: Record<string, unknown> = {};
  protected _toolOutput: unknown = undefined;
  protected _structuredContent: unknown = undefined;
  protected _initialized = false;

  protected _contextListeners: Set<(changes: Partial<HostContext>) => void> = new Set();
  protected _toolResultListeners: Set<(result: unknown) => void> = new Set();

  constructor() {
    this._hostContext = this._createDefaultHostContext();
  }

  get capabilities(): AdapterCapabilities {
    return this._capabilities;
  }

  // ============================================
  // Lifecycle (override in subclasses)
  // ============================================

  abstract canHandle(): boolean;

  async initialize(): Promise<void> {
    if (this._initialized) return;

    // Load persisted widget state
    this._loadWidgetState();

    // Read injected tool data
    this._readInjectedData();

    this._initialized = true;
  }

  dispose(): void {
    this._contextListeners.clear();
    this._toolResultListeners.clear();
    this._initialized = false;
  }

  // ============================================
  // Data Access
  // ============================================

  getTheme(): 'light' | 'dark' {
    return this._hostContext.theme;
  }

  getDisplayMode(): DisplayMode {
    return this._hostContext.displayMode;
  }

  getUserAgent(): UserAgentInfo {
    return this._hostContext.userAgent;
  }

  getLocale(): string {
    return this._hostContext.locale;
  }

  getToolInput(): Record<string, unknown> {
    return this._toolInput;
  }

  getToolOutput(): unknown {
    return this._toolOutput;
  }

  getStructuredContent(): unknown {
    return this._structuredContent;
  }

  getWidgetState(): Record<string, unknown> {
    return this._widgetState;
  }

  getSafeArea(): SafeAreaInsets {
    return this._hostContext.safeArea;
  }

  getViewport(): ViewportInfo | undefined {
    return this._hostContext.viewport;
  }

  getHostContext(): HostContext {
    return { ...this._hostContext };
  }

  // ============================================
  // Actions (override in subclasses for real functionality)
  // ============================================

  async callTool(_name: string, _args: Record<string, unknown>): Promise<unknown> {
    if (!this._capabilities.canCallTools) {
      throw new Error(`Tool calls are not supported by ${this.name} adapter`);
    }
    throw new Error('callTool not implemented');
  }

  async sendMessage(_content: string): Promise<void> {
    if (!this._capabilities.canSendMessages) {
      throw new Error(`Sending messages is not supported by ${this.name} adapter`);
    }
    throw new Error('sendMessage not implemented');
  }

  async openLink(url: string): Promise<void> {
    if (!this._capabilities.canOpenLinks) {
      // Fallback: try window.open
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      throw new Error(`Opening links is not supported by ${this.name} adapter`);
    }
    throw new Error('openLink not implemented');
  }

  async requestDisplayMode(_mode: DisplayMode): Promise<void> {
    if (!this._capabilities.supportsDisplayModes) {
      // Silently ignore on unsupported platforms
      return;
    }
    throw new Error('requestDisplayMode not implemented');
  }

  async requestClose(): Promise<void> {
    // Default: no-op (host controls widget lifecycle)
  }

  setWidgetState(state: Record<string, unknown>): void {
    this._widgetState = { ...this._widgetState, ...state };
    this._persistWidgetState();
  }

  // ============================================
  // Events
  // ============================================

  onContextChange(callback: (changes: Partial<HostContext>) => void): () => void {
    this._contextListeners.add(callback);
    return () => {
      this._contextListeners.delete(callback);
    };
  }

  onToolResult(callback: (result: unknown) => void): () => void {
    this._toolResultListeners.add(callback);
    return () => {
      this._toolResultListeners.delete(callback);
    };
  }

  // ============================================
  // Protected Helpers
  // ============================================

  /**
   * Create default host context from environment detection.
   */
  protected _createDefaultHostContext(): HostContext {
    return {
      theme: this._detectTheme(),
      displayMode: 'inline',
      locale: this._detectLocale(),
      userAgent: this._detectUserAgent(),
      safeArea: DEFAULT_SAFE_AREA,
      viewport: this._detectViewport(),
    };
  }

  /**
   * Detect theme from CSS media query.
   */
  protected _detectTheme(): 'light' | 'dark' {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }

  /**
   * Detect locale from navigator.
   */
  protected _detectLocale(): string {
    if (typeof navigator !== 'undefined') {
      return navigator.language || 'en-US';
    }
    return 'en-US';
  }

  /**
   * Detect user agent capabilities.
   */
  protected _detectUserAgent(): UserAgentInfo {
    if (typeof navigator === 'undefined') {
      return { type: 'web', hover: true, touch: false };
    }

    const ua = navigator.userAgent || '';
    const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const hasHover = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: hover)').matches;

    return {
      type: isMobile ? 'mobile' : 'web',
      hover: hasHover !== false,
      touch: hasTouch,
    };
  }

  /**
   * Detect viewport dimensions.
   */
  protected _detectViewport(): ViewportInfo | undefined {
    if (typeof window !== 'undefined') {
      return {
        width: window.innerWidth,
        height: window.innerHeight,
      };
    }
    return undefined;
  }

  /**
   * Read injected tool data from window globals.
   */
  protected _readInjectedData(): void {
    if (typeof window === 'undefined') return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;

    if (win.__mcpToolInput) {
      this._toolInput = win.__mcpToolInput;
    }
    if (win.__mcpToolOutput) {
      this._toolOutput = win.__mcpToolOutput;
    }
    if (win.__mcpStructuredContent) {
      this._structuredContent = win.__mcpStructuredContent;
    }
    if (win.__mcpHostContext) {
      this._hostContext = { ...this._hostContext, ...win.__mcpHostContext };
    }
  }

  /**
   * Load widget state from localStorage.
   */
  protected _loadWidgetState(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const key = this._getStateKey();
      const stored = localStorage.getItem(key);
      if (stored) {
        this._widgetState = JSON.parse(stored);
      }
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Persist widget state to localStorage.
   */
  protected _persistWidgetState(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const key = this._getStateKey();
      localStorage.setItem(key, JSON.stringify(this._widgetState));
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Get localStorage key for widget state.
   */
  protected _getStateKey(): string {
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolName = (window as any).__mcpToolName || 'unknown';
      return `frontmcp:widget:${toolName}`;
    }
    return 'frontmcp:widget:unknown';
  }

  /**
   * Notify context change listeners.
   */
  protected _notifyContextChange(changes: Partial<HostContext>): void {
    this._hostContext = { ...this._hostContext, ...changes };
    this._contextListeners.forEach((cb) => {
      try {
        cb(changes);
      } catch (e) {
        console.error('[FrontMcpBridge] Context change listener error:', e);
      }
    });
  }

  /**
   * Notify tool result listeners.
   */
  protected _notifyToolResult(result: unknown): void {
    this._toolOutput = result;
    this._toolResultListeners.forEach((cb) => {
      try {
        cb(result);
      } catch (e) {
        console.error('[FrontMcpBridge] Tool result listener error:', e);
      }
    });
  }
}
