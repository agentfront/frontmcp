/**
 * Generic Platform Adapter
 *
 * Fallback adapter for unknown or unsupported platforms.
 * Provides basic functionality using standard web APIs.
 *
 * @packageDocumentation
 */

import { BaseAdapter, DEFAULT_CAPABILITIES } from './base-adapter';

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
export class GenericAdapter extends BaseAdapter {
  readonly id = 'generic';
  readonly name = 'Generic Web';
  readonly priority = 0; // Lowest priority - fallback only

  constructor() {
    super();
    this._capabilities = {
      ...DEFAULT_CAPABILITIES,
      canCallTools: false,
      canSendMessages: false,
      canOpenLinks: true, // window.open works
      canPersistState: true, // localStorage works
      hasNetworkAccess: true, // Assume network available
      supportsDisplayModes: false,
      supportsTheme: true, // System theme detection
    };
  }

  /**
   * Generic adapter can always handle the environment.
   * It serves as the fallback when no other adapter matches.
   */
  canHandle(): boolean {
    // Always return true - this is the fallback adapter
    return typeof window !== 'undefined';
  }

  /**
   * Initialize the generic adapter.
   */
  override async initialize(): Promise<void> {
    if (this._initialized) return;

    // Call base initialization
    await super.initialize();

    // Setup theme listener
    this._setupThemeListener();
  }

  /**
   * Open a link using window.open.
   */
  override async openLink(url: string): Promise<void> {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Setup listener for system theme changes.
   */
  private _setupThemeListener(): void {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      const newTheme = e.matches ? 'dark' : 'light';
      if (newTheme !== this._hostContext.theme) {
        this._notifyContextChange({ theme: newTheme });
      }
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleChange);
    }
  }
}

/**
 * Factory function for creating generic adapter instances.
 */
export function createGenericAdapter(): GenericAdapter {
  return new GenericAdapter();
}
