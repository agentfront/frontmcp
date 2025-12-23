// file: libs/browser/src/polyfill/navigator-model-context.ts
/**
 * Navigator Model Context Polyfill
 *
 * This polyfill adds the `navigator.modelContext` API to the browser,
 * providing W3C-aligned browser-native access to MCP functionality.
 *
 * Import this at your application entry point:
 * ```typescript
 * import '@frontmcp/browser/polyfill';
 * ```
 */

import { BrowserMcpServer } from '../server';
import { ModelContextSessionImpl } from './model-context-session';
import type {
  NavigatorModelContext,
  ConnectOptions,
  ModelContextSession,
  ModelContextConnectionError,
  ModelContextTimeoutError,
} from './types';
import { ModelContextConnectionError as ConnectionError, ModelContextTimeoutError as TimeoutError } from './types';

/**
 * Polyfill version string
 */
const POLYFILL_VERSION = '1.0.0';

/**
 * Active sessions for cleanup
 */
const activeSessions: Set<ModelContextSessionImpl> = new Set();

/**
 * Create a new ModelContext connection
 */
async function connect(options: ConnectOptions): Promise<ModelContextSession> {
  const { serverInfo, timeout = 30000 } = options;

  // Create the browser MCP server
  const server = new BrowserMcpServer({
    name: serverInfo.name,
    version: serverInfo.version,
    capabilities: options.capabilities,
  });

  // Create session wrapper
  const session = new ModelContextSessionImpl(server);

  // Set up timeout
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(`Connection timed out after ${timeout}ms`));
    }, timeout);
  });

  try {
    // Race initialization against timeout
    await Promise.race([session.initialize(), timeoutPromise]);

    // Clear timeout on success
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Track session for cleanup
    activeSessions.add(session);

    // Remove from tracking when closed
    session.on('disconnect', () => {
      activeSessions.delete(session);
    });

    return session;
  } catch (error) {
    // Clear timeout on error
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (error instanceof TimeoutError) {
      throw error;
    }

    throw new ConnectionError(error instanceof Error ? error.message : 'Failed to connect to model context');
  }
}

/**
 * The navigator.modelContext polyfill implementation
 */
const modelContextPolyfill: NavigatorModelContext = {
  connect,
  get supported() {
    return true;
  },
  get polyfillVersion() {
    return POLYFILL_VERSION;
  },
};

/**
 * Install the polyfill on the navigator object
 */
function installPolyfill(): void {
  // Check if already installed (native or polyfill)
  if ('modelContext' in navigator) {
    // Don't override native implementation
    const existing = navigator.modelContext;
    if (existing && !existing.polyfillVersion) {
      console.log('[FrontMCP] Native navigator.modelContext detected, skipping polyfill');
      return;
    }
    // Already polyfilled
    return;
  }

  // Install polyfill
  Object.defineProperty(navigator, 'modelContext', {
    value: modelContextPolyfill,
    writable: false,
    enumerable: true,
    configurable: false,
  });

  console.log(`[FrontMCP] navigator.modelContext polyfill installed (v${POLYFILL_VERSION})`);
}

/**
 * Clean up all active sessions
 */
export async function cleanup(): Promise<void> {
  const sessions = Array.from(activeSessions);
  await Promise.all(sessions.map((session) => session.close()));
  activeSessions.clear();
}

/**
 * Check if the polyfill is installed
 */
export function isInstalled(): boolean {
  return 'modelContext' in navigator;
}

/**
 * Get the polyfill version (or undefined if native)
 */
export function getPolyfillVersion(): string | undefined {
  return navigator.modelContext?.polyfillVersion;
}

// Auto-install polyfill when module is imported
if (typeof navigator !== 'undefined') {
  installPolyfill();
}

// Re-export types
export type {
  NavigatorModelContext,
  ConnectOptions,
  ModelContextSession,
  ModelContextConnectionError,
  ModelContextTimeoutError,
};
