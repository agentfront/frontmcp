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
import { BaseAdapter, DEFAULT_CAPABILITIES } from './base-adapter';

/**
 * Allowed Claude domains for security validation.
 */
const CLAUDE_DOMAINS = ['claude.ai', 'anthropic.com'];

/**
 * Check if a hostname is a valid Claude domain.
 * Validates exact match or proper subdomain (prevents attacker.com/claude.ai attacks).
 */
function isValidClaudeDomain(hostname: string): boolean {
  const lowerHost = hostname.toLowerCase();
  return CLAUDE_DOMAINS.some((domain) => lowerHost === domain || lowerHost.endsWith('.' + domain));
}

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
export class ClaudeAdapter extends BaseAdapter {
  readonly id = 'claude';
  readonly name = 'Claude (Anthropic)';
  readonly priority = 60;

  constructor() {
    super();
    this._capabilities = {
      ...DEFAULT_CAPABILITIES,
      canCallTools: false, // Claude artifacts can't call tools
      canSendMessages: false, // Can't send messages back to conversation
      canOpenLinks: true, // Can open links via window.open
      canPersistState: true, // localStorage works
      hasNetworkAccess: false, // Network is blocked
      supportsDisplayModes: false, // No display mode control
      supportsTheme: true, // Can detect system theme
    };
  }

  /**
   * Check if we're running in a Claude legacy artifact/widget context.
   *
   * Claude MCP Apps (2026+) uses the ext-apps adapter instead.
   * This adapter only handles legacy Claude artifacts without MCP Apps support.
   */
  canHandle(): boolean {
    if (typeof window === 'undefined') return false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;

    // If MCP Apps is enabled, let ext-apps adapter handle it
    // See: https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/
    if (win.__mcpAppsEnabled) return false;
    if (win.__mcpPlatform === 'ext-apps') return false;
    if (win.__extAppsInitialized) return false;

    // Legacy Claude detection
    if (win.__mcpPlatform === 'claude') return true;

    // Check for Claude-specific global
    if (win.claude) return true;

    // Check for Claude artifact markers
    if (win.__claudeArtifact) return true;

    // Check URL patterns for Claude (legacy only)
    // Use proper domain validation to prevent subdomain attacks
    if (typeof location !== 'undefined') {
      if (isValidClaudeDomain(location.hostname)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Initialize the Claude adapter.
   */
  override async initialize(): Promise<void> {
    if (this._initialized) return;

    // Call base initialization (loads state, reads injected data)
    await super.initialize();

    // Setup theme detection listener
    this._setupThemeListener();
  }

  /**
   * Open a link in a new tab.
   * This is one of the few actions available in Claude artifacts.
   */
  override async openLink(url: string): Promise<void> {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  /**
   * Request display mode change (no-op for Claude).
   */
  override async requestDisplayMode(_mode: DisplayMode): Promise<void> {
    // Claude doesn't support display mode changes
    // Silently ignore
  }

  /**
   * Request close (no-op for Claude).
   */
  override async requestClose(): Promise<void> {
    // Claude artifacts can't close themselves
    // Silently ignore
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

    // Use addEventListener if available (newer API)
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else if (mediaQuery.addListener) {
      // Fallback for older browsers
      mediaQuery.addListener(handleChange);
    }
  }
}

/**
 * Factory function for creating Claude adapter instances.
 */
export function createClaudeAdapter(): ClaudeAdapter {
  return new ClaudeAdapter();
}
