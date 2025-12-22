/**
 * Claude Platform Adapter
 *
 * Adapter for Claude (Anthropic) artifacts and widgets.
 * Claude artifacts have network restrictions - external fetches are blocked.
 * This adapter relies on injected data and localStorage for state.
 *
 * @packageDocumentation
 */
import type { DisplayMode } from '../types';
import { BaseAdapter } from './base-adapter';
/**
 * Claude adapter for Anthropic's Claude AI.
 *
 * Features:
 * - Theme detection from system preferences
 * - Injected tool data via window globals
 * - LocalStorage persistence for widget state
 * - No external network access (blocked by Claude)
 *
 * @example
 * ```typescript
 * import { ClaudeAdapter } from '@frontmcp/ui/bridge';
 *
 * const adapter = new ClaudeAdapter();
 * if (adapter.canHandle()) {
 *   await adapter.initialize();
 *   const input = adapter.getToolInput();
 * }
 * ```
 */
export declare class ClaudeAdapter extends BaseAdapter {
  readonly id = 'claude';
  readonly name = 'Claude (Anthropic)';
  readonly priority = 60;
  constructor();
  /**
   * Check if we're running in a Claude artifact/widget context.
   */
  canHandle(): boolean;
  /**
   * Initialize the Claude adapter.
   */
  initialize(): Promise<void>;
  /**
   * Open a link in a new tab.
   * This is one of the few actions available in Claude artifacts.
   */
  openLink(url: string): Promise<void>;
  /**
   * Request display mode change (no-op for Claude).
   */
  requestDisplayMode(_mode: DisplayMode): Promise<void>;
  /**
   * Request close (no-op for Claude).
   */
  requestClose(): Promise<void>;
  /**
   * Setup listener for system theme changes.
   */
  private _setupThemeListener;
}
/**
 * Factory function for creating Claude adapter instances.
 */
export declare function createClaudeAdapter(): ClaudeAdapter;
//# sourceMappingURL=claude.adapter.d.ts.map
