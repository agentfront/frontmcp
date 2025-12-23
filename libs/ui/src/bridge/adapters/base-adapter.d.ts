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
export declare const DEFAULT_CAPABILITIES: AdapterCapabilities;
/**
 * Default safe area insets (no insets).
 */
export declare const DEFAULT_SAFE_AREA: SafeAreaInsets;
/**
 * Abstract base class for platform adapters.
 * Provides default implementations that can be overridden.
 */
export declare abstract class BaseAdapter implements PlatformAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly priority: number;
  protected _capabilities: AdapterCapabilities;
  protected _hostContext: HostContext;
  protected _widgetState: Record<string, unknown>;
  protected _toolInput: Record<string, unknown>;
  protected _toolOutput: unknown;
  protected _structuredContent: unknown;
  protected _initialized: boolean;
  protected _contextListeners: Set<(changes: Partial<HostContext>) => void>;
  protected _toolResultListeners: Set<(result: unknown) => void>;
  constructor();
  get capabilities(): AdapterCapabilities;
  abstract canHandle(): boolean;
  initialize(): Promise<void>;
  dispose(): void;
  getTheme(): 'light' | 'dark';
  getDisplayMode(): DisplayMode;
  getUserAgent(): UserAgentInfo;
  getLocale(): string;
  getToolInput(): Record<string, unknown>;
  getToolOutput(): unknown;
  getStructuredContent(): unknown;
  getWidgetState(): Record<string, unknown>;
  getSafeArea(): SafeAreaInsets;
  getViewport(): ViewportInfo | undefined;
  getHostContext(): HostContext;
  callTool(_name: string, _args: Record<string, unknown>): Promise<unknown>;
  sendMessage(_content: string): Promise<void>;
  openLink(url: string): Promise<void>;
  requestDisplayMode(_mode: DisplayMode): Promise<void>;
  requestClose(): Promise<void>;
  setWidgetState(state: Record<string, unknown>): void;
  onContextChange(callback: (changes: Partial<HostContext>) => void): () => void;
  onToolResult(callback: (result: unknown) => void): () => void;
  /**
   * Create default host context from environment detection.
   */
  protected _createDefaultHostContext(): HostContext;
  /**
   * Detect theme from CSS media query.
   */
  protected _detectTheme(): 'light' | 'dark';
  /**
   * Detect locale from navigator.
   */
  protected _detectLocale(): string;
  /**
   * Detect user agent capabilities.
   */
  protected _detectUserAgent(): UserAgentInfo;
  /**
   * Detect viewport dimensions.
   */
  protected _detectViewport(): ViewportInfo | undefined;
  /**
   * Read injected tool data from window globals.
   */
  protected _readInjectedData(): void;
  /**
   * Load widget state from localStorage.
   */
  protected _loadWidgetState(): void;
  /**
   * Persist widget state to localStorage.
   */
  protected _persistWidgetState(): void;
  /**
   * Get localStorage key for widget state.
   */
  protected _getStateKey(): string;
  /**
   * Notify context change listeners.
   */
  protected _notifyContextChange(changes: Partial<HostContext>): void;
  /**
   * Notify tool result listeners.
   */
  protected _notifyToolResult(result: unknown): void;
}
//# sourceMappingURL=base-adapter.d.ts.map
