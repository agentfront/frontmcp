/**
 * Gemini Platform Adapter
 *
 * Adapter for Google's Gemini AI platform.
 * Provides integration with Gemini-specific features and APIs.
 *
 * @packageDocumentation
 */
import { BaseAdapter } from './base-adapter';
/**
 * Gemini adapter for Google's AI platform.
 *
 * Features:
 * - Theme detection from Gemini SDK or system
 * - Network access for external resources
 * - LocalStorage persistence
 * - Link opening capability
 *
 * @example
 * ```typescript
 * import { GeminiAdapter } from '@frontmcp/ui/bridge';
 *
 * const adapter = new GeminiAdapter();
 * if (adapter.canHandle()) {
 *   await adapter.initialize();
 * }
 * ```
 */
export declare class GeminiAdapter extends BaseAdapter {
  readonly id = 'gemini';
  readonly name = 'Google Gemini';
  readonly priority = 40;
  private _gemini;
  constructor();
  /**
   * Check if we're running in a Gemini context.
   */
  canHandle(): boolean;
  /**
   * Initialize the Gemini adapter.
   */
  initialize(): Promise<void>;
  /**
   * Get current theme.
   */
  getTheme(): 'light' | 'dark';
  /**
   * Send a message (if supported by SDK).
   */
  sendMessage(content: string): Promise<void>;
  /**
   * Open a link.
   */
  openLink(url: string): Promise<void>;
  /**
   * Setup listener for system theme changes.
   */
  private _setupThemeListener;
}
/**
 * Factory function for creating Gemini adapter instances.
 */
export declare function createGeminiAdapter(): GeminiAdapter;
//# sourceMappingURL=gemini.adapter.d.ts.map
