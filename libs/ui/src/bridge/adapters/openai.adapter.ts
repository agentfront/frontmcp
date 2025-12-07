/**
 * OpenAI Platform Adapter
 *
 * Adapter for OpenAI's ChatGPT Apps SDK.
 * Provides full widget functionality including tool calls, messaging,
 * and display mode changes via the window.openai API.
 *
 * @packageDocumentation
 */

import type { DisplayMode, HostContext } from '../types';
import { BaseAdapter, DEFAULT_CAPABILITIES } from './base-adapter';

/**
 * OpenAI SDK global interface (simplified type).
 */
interface OpenAISDK {
  canvas?: {
    getTheme(): string;
    getDisplayMode(): string;
    setDisplayMode(mode: string): Promise<void>;
    sendMessage(text: string): Promise<void>;
    openLink(url: string): Promise<void>;
    callServerTool(name: string, args: Record<string, unknown>): Promise<unknown>;
    onContextChange(callback: (context: Partial<HostContext>) => void): () => void;
    onToolResult?(callback: (result: unknown) => void): () => void;
    close(): Promise<void>;
    getContext?(): Partial<HostContext>;
  };
}

/**
 * OpenAI Apps SDK adapter.
 *
 * Detects the presence of `window.openai` and proxies all operations
 * through the ChatGPT Apps SDK.
 *
 * @example
 * ```typescript
 * import { OpenAIAdapter } from '@frontmcp/ui/bridge';
 *
 * const adapter = new OpenAIAdapter();
 * if (adapter.canHandle()) {
 *   await adapter.initialize();
 *   const theme = adapter.getTheme();
 * }
 * ```
 */
export class OpenAIAdapter extends BaseAdapter {
  readonly id = 'openai';
  readonly name = 'OpenAI ChatGPT';
  readonly priority = 100; // Highest priority

  private _openai: OpenAISDK | undefined;
  private _unsubscribeContext: (() => void) | undefined;
  private _unsubscribeToolResult: (() => void) | undefined;

  constructor() {
    super();
    this._capabilities = {
      ...DEFAULT_CAPABILITIES,
      canCallTools: true,
      canSendMessages: true,
      canOpenLinks: true,
      canPersistState: true,
      hasNetworkAccess: true,
      supportsDisplayModes: true,
      supportsTheme: true,
    };
  }

  /**
   * Check if OpenAI Apps SDK is available.
   */
  canHandle(): boolean {
    if (typeof window === 'undefined') return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    return Boolean(win.openai?.canvas);
  }

  /**
   * Initialize the OpenAI adapter.
   */
  override async initialize(): Promise<void> {
    if (this._initialized) return;

    // Get OpenAI SDK reference
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._openai = (window as any).openai as OpenAISDK;

    // Call base initialization (loads widget state, reads injected data)
    await super.initialize();

    // Get initial context from OpenAI SDK
    this._syncContextFromSDK();

    // Subscribe to context changes
    if (this._openai?.canvas?.onContextChange) {
      this._unsubscribeContext = this._openai.canvas.onContextChange((changes) => {
        this._notifyContextChange(changes);
      });
    }

    // Subscribe to tool results if available
    if (this._openai?.canvas?.onToolResult) {
      this._unsubscribeToolResult = this._openai.canvas.onToolResult((result) => {
        this._notifyToolResult(result);
      });
    }
  }

  /**
   * Dispose adapter resources.
   */
  override dispose(): void {
    if (this._unsubscribeContext) {
      this._unsubscribeContext();
      this._unsubscribeContext = undefined;
    }
    if (this._unsubscribeToolResult) {
      this._unsubscribeToolResult();
      this._unsubscribeToolResult = undefined;
    }
    this._openai = undefined;
    super.dispose();
  }

  // ============================================
  // Data Access (override with SDK calls)
  // ============================================

  override getTheme(): 'light' | 'dark' {
    if (this._openai?.canvas?.getTheme) {
      const theme = this._openai.canvas.getTheme();
      return theme === 'dark' ? 'dark' : 'light';
    }
    return super.getTheme();
  }

  override getDisplayMode(): DisplayMode {
    if (this._openai?.canvas?.getDisplayMode) {
      const mode = this._openai.canvas.getDisplayMode();
      if (mode === 'fullscreen' || mode === 'pip' || mode === 'carousel') {
        return mode;
      }
      return 'inline';
    }
    return super.getDisplayMode();
  }

  // ============================================
  // Actions (proxy to SDK)
  // ============================================

  override async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this._openai?.canvas?.callServerTool) {
      throw new Error('callServerTool not available in OpenAI SDK');
    }
    return this._openai.canvas.callServerTool(name, args);
  }

  override async sendMessage(content: string): Promise<void> {
    if (!this._openai?.canvas?.sendMessage) {
      throw new Error('sendMessage not available in OpenAI SDK');
    }
    await this._openai.canvas.sendMessage(content);
  }

  override async openLink(url: string): Promise<void> {
    if (!this._openai?.canvas?.openLink) {
      // Fallback to window.open
      return super.openLink(url);
    }
    await this._openai.canvas.openLink(url);
  }

  override async requestDisplayMode(mode: DisplayMode): Promise<void> {
    if (!this._openai?.canvas?.setDisplayMode) {
      return super.requestDisplayMode(mode);
    }
    await this._openai.canvas.setDisplayMode(mode);
    this._hostContext = { ...this._hostContext, displayMode: mode };
  }

  override async requestClose(): Promise<void> {
    if (this._openai?.canvas?.close) {
      await this._openai.canvas.close();
    }
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Sync context from OpenAI SDK.
   */
  private _syncContextFromSDK(): void {
    if (!this._openai?.canvas) return;

    // Update theme
    if (this._openai.canvas.getTheme) {
      const theme = this._openai.canvas.getTheme();
      this._hostContext.theme = theme === 'dark' ? 'dark' : 'light';
    }

    // Update display mode
    if (this._openai.canvas.getDisplayMode) {
      const mode = this._openai.canvas.getDisplayMode();
      if (mode === 'fullscreen' || mode === 'pip' || mode === 'carousel' || mode === 'inline') {
        this._hostContext.displayMode = mode;
      }
    }

    // Get full context if available
    if (this._openai.canvas.getContext) {
      const ctx = this._openai.canvas.getContext();
      if (ctx) {
        this._hostContext = { ...this._hostContext, ...ctx };
      }
    }
  }
}

/**
 * Factory function for creating OpenAI adapter instances.
 */
export function createOpenAIAdapter(): OpenAIAdapter {
  return new OpenAIAdapter();
}
