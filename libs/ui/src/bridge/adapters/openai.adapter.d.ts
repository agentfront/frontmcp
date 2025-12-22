/**
 * OpenAI Platform Adapter
 *
 * Adapter for OpenAI's ChatGPT Apps SDK.
 * Provides full widget functionality including tool calls, messaging,
 * and display mode changes via the window.openai API.
 *
 * @packageDocumentation
 */
import type { DisplayMode } from '../types';
import { BaseAdapter } from './base-adapter';
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
export declare class OpenAIAdapter extends BaseAdapter {
  readonly id = 'openai';
  readonly name = 'OpenAI ChatGPT';
  readonly priority = 100;
  private _openai;
  private _unsubscribeContext;
  private _unsubscribeToolResult;
  constructor();
  /**
   * Check if OpenAI Apps SDK is available.
   */
  canHandle(): boolean;
  /**
   * Initialize the OpenAI adapter.
   */
  initialize(): Promise<void>;
  /**
   * Dispose adapter resources.
   */
  dispose(): void;
  getTheme(): 'light' | 'dark';
  getDisplayMode(): DisplayMode;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  sendMessage(content: string): Promise<void>;
  openLink(url: string): Promise<void>;
  requestDisplayMode(mode: DisplayMode): Promise<void>;
  requestClose(): Promise<void>;
  /**
   * Sync context from OpenAI SDK.
   */
  private _syncContextFromSDK;
}
/**
 * Factory function for creating OpenAI adapter instances.
 */
export declare function createOpenAIAdapter(): OpenAIAdapter;
//# sourceMappingURL=openai.adapter.d.ts.map
