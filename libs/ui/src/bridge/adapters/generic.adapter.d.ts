/**
 * Generic Platform Adapter
 *
 * Fallback adapter for unknown or unsupported platforms.
 * Provides basic functionality using standard web APIs.
 *
 * @packageDocumentation
 */
import { BaseAdapter } from './base-adapter';
/**
 * Generic fallback adapter.
 *
 * Used when no platform-specific adapter matches the current environment.
 * Provides basic functionality:
 * - Theme detection from system preferences
 * - LocalStorage persistence
 * - Link opening via window.open
 * - Injected tool data from window globals
 *
 * @example
 * ```typescript
 * import { GenericAdapter } from '@frontmcp/ui/bridge';
 *
 * const adapter = new GenericAdapter();
 * await adapter.initialize();
 * const theme = adapter.getTheme();
 * ```
 */
export declare class GenericAdapter extends BaseAdapter {
  readonly id = 'generic';
  readonly name = 'Generic Web';
  readonly priority = 0;
  constructor();
  /**
   * Generic adapter can always handle the environment.
   * It serves as the fallback when no other adapter matches.
   */
  canHandle(): boolean;
  /**
   * Initialize the generic adapter.
   */
  initialize(): Promise<void>;
  /**
   * Open a link using window.open.
   */
  openLink(url: string): Promise<void>;
  /**
   * Setup listener for system theme changes.
   */
  private _setupThemeListener;
}
/**
 * Factory function for creating generic adapter instances.
 */
export declare function createGenericAdapter(): GenericAdapter;
//# sourceMappingURL=generic.adapter.d.ts.map
