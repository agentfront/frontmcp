/**
 * Gemini Platform Adapter
 *
 * Adapter for Google's Gemini AI platform.
 * Provides integration with Gemini-specific features and APIs.
 *
 * @packageDocumentation
 */

import { BaseAdapter, DEFAULT_CAPABILITIES } from './base-adapter';

/**
 * Allowed Gemini domains for security validation.
 */
const GEMINI_DOMAINS = ['gemini.google.com', 'bard.google.com'];

/**
 * Check if a hostname is a valid Gemini domain.
 * Validates exact match or proper subdomain (prevents attacker.com/gemini.google.com attacks).
 */
function isValidGeminiDomain(hostname: string): boolean {
  const lowerHost = hostname.toLowerCase();
  return GEMINI_DOMAINS.some(domain =>
    lowerHost === domain || lowerHost.endsWith('.' + domain)
  );
}

/**
 * Gemini SDK global interface (simplified type).
 */
interface GeminiSDK {
  ui?: {
    getTheme?(): string;
    sendMessage?(content: string): Promise<void>;
    openLink?(url: string): Promise<void>;
  };
}

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
export class GeminiAdapter extends BaseAdapter {
  readonly id = 'gemini';
  readonly name = 'Google Gemini';
  readonly priority = 40;

  private _gemini: GeminiSDK | undefined;

  constructor() {
    super();
    this._capabilities = {
      ...DEFAULT_CAPABILITIES,
      canCallTools: false, // May be enabled if SDK supports it
      canSendMessages: false, // May be enabled if SDK supports it
      canOpenLinks: true,
      canPersistState: true,
      hasNetworkAccess: true,
      supportsDisplayModes: false,
      supportsTheme: true,
    };
  }

  /**
   * Check if we're running in a Gemini context.
   */
  canHandle(): boolean {
    if (typeof window === 'undefined') return false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;

    // Check explicit platform marker
    if (win.__mcpPlatform === 'gemini') return true;

    // Check for Gemini-specific global
    if (win.gemini) return true;

    // Check URL patterns for Gemini
    // Use proper domain validation to prevent subdomain attacks
    if (typeof location !== 'undefined') {
      if (isValidGeminiDomain(location.hostname)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Initialize the Gemini adapter.
   */
  override async initialize(): Promise<void> {
    if (this._initialized) return;

    // Get Gemini SDK reference if available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    this._gemini = win.gemini as GeminiSDK | undefined;

    // Update capabilities based on available SDK features
    if (this._gemini?.ui) {
      if (this._gemini.ui.sendMessage) {
        this._capabilities = { ...this._capabilities, canSendMessages: true };
      }
    }

    // Call base initialization
    await super.initialize();

    // Setup theme listener
    this._setupThemeListener();
  }

  /**
   * Get current theme.
   */
  override getTheme(): 'light' | 'dark' {
    if (this._gemini?.ui?.getTheme) {
      const theme = this._gemini.ui.getTheme();
      return theme === 'dark' ? 'dark' : 'light';
    }
    return super.getTheme();
  }

  /**
   * Send a message (if supported by SDK).
   */
  override async sendMessage(content: string): Promise<void> {
    if (this._gemini?.ui?.sendMessage) {
      await this._gemini.ui.sendMessage(content);
      return;
    }
    throw new Error('Sending messages is not supported by Gemini adapter');
  }

  /**
   * Open a link.
   */
  override async openLink(url: string): Promise<void> {
    if (this._gemini?.ui?.openLink) {
      await this._gemini.ui.openLink(url);
      return;
    }
    // Fallback to window.open
    return super.openLink(url);
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
      // Only update if not using SDK theme
      if (!this._gemini?.ui?.getTheme) {
        const newTheme = e.matches ? 'dark' : 'light';
        if (newTheme !== this._hostContext.theme) {
          this._notifyContextChange({ theme: newTheme });
        }
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
 * Factory function for creating Gemini adapter instances.
 */
export function createGeminiAdapter(): GeminiAdapter {
  return new GeminiAdapter();
}
