/**
 * Platform Bridge - Reactive Data Store for Tool UI
 *
 * Provides a reactive interface for tool output data that works across:
 * - React (via useSyncExternalStore)
 * - HTMX (via custom events)
 * - Vanilla JS (via subscribe callbacks)
 *
 * Uses Object.defineProperty to intercept when platforms inject data,
 * automatically detecting and notifying subscribers when data changes.
 *
 * @example React integration
 * ```tsx
 * import { useSyncExternalStore } from 'react';
 *
 * function useToolOutput() {
 *   return useSyncExternalStore(
 *     window.__frontmcp.bridge.subscribe,
 *     window.__frontmcp.bridge.getSnapshot,
 *     window.__frontmcp.bridge.getServerSnapshot
 *   );
 * }
 * ```
 *
 * @example Vanilla JS
 * ```javascript
 * const unsubscribe = window.__frontmcp.bridge.subscribe(() => {
 *   const state = window.__frontmcp.bridge.getState();
 *   if (!state.loading) {
 *     renderWidget(state.data);
 *   }
 * });
 * ```
 *
 * @example HTMX
 * ```html
 * <div hx-trigger="frontmcp:change from:document" hx-get="/render">
 *   Loading...
 * </div>
 * ```
 */

/**
 * Bridge state containing data, loading status, and error information.
 */
export interface BridgeState<T = unknown> {
  /** Current data (null when loading or no data) */
  data: T | null;
  /** Whether the bridge is waiting for data */
  loading: boolean;
  /** Error message if data loading failed */
  error: string | null;
}

/**
 * Platform Bridge interface for reactive data access.
 */
export interface PlatformBridge<T = unknown> {
  /** Get current state snapshot */
  getState(): BridgeState<T>;
  /** Subscribe to state changes */
  subscribe(callback: () => void): () => void;
  /** React useSyncExternalStore compatible getSnapshot */
  getSnapshot(): BridgeState<T>;
  /** React SSR compatible getServerSnapshot */
  getServerSnapshot(): BridgeState<T>;
  /** Check if bridge has received data */
  hasData(): boolean;
  /** Manually set data (for testing or custom injection) */
  setData(data: T): void;
  /** Manually set error */
  setError(error: string): void;
  /** Reset to loading state */
  reset(): void;
}

/**
 * Render the Platform Bridge inline script.
 *
 * This script creates a reactive data store that:
 * 1. Installs interceptors on window.openai to detect data injection
 * 2. Provides subscribe/getState API for React/HTMX/vanilla integration
 * 3. Dispatches custom events for HTMX compatibility
 * 4. Handles the race condition between iframe load and data injection
 *
 * @returns Script tag with bridge implementation
 */
export function renderBridgeScript(): string {
  return `<script>
(function() {
  'use strict';

  // ============================================
  // Debug Mode
  // ============================================

  var DEBUG = window.location.search.indexOf('frontmcp_debug=1') > -1 ||
              window.localStorage.getItem('frontmcp_debug') === '1';
  var debugLog = [];

  function log(level, message, data) {
    var entry = {
      ts: new Date().toISOString(),
      level: level,
      message: message,
      data: data
    };
    debugLog.push(entry);
    if (DEBUG) {
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
        '[frontmcp] ' + message,
        data || ''
      );
    }
  }

  // ============================================
  // Bridge State Management
  // ============================================

  var state = { data: null, loading: true, error: null };
  var subscribers = [];
  var stateVersion = 0;  // For React useSyncExternalStore stability

  function notify() {
    stateVersion++;
    for (var i = 0; i < subscribers.length; i++) {
      try { subscribers[i](); } catch(e) {
        log('error', 'Subscriber error:', { error: e.message, stack: e.stack });
      }
    }
    // Dispatch custom event for HTMX
    if (typeof CustomEvent !== 'undefined') {
      document.dispatchEvent(new CustomEvent('frontmcp:change', { detail: state }));
    }
  }

  function setData(data) {
    // Skip if data hasn't actually changed (prevents unnecessary re-renders)
    if (!state.loading && state.data === data) return;
    log('info', 'setData called', {
      dataType: typeof data,
      dataLength: typeof data === 'string' ? data.length : 'N/A',
      isNull: data === null,
      isUndefined: data === undefined
    });
    state = { data: data, loading: false, error: null };
    notify();
  }

  function setError(error) {
    log('error', 'setError called', { error: error });
    state = { data: null, loading: false, error: error };
    notify();
  }

  function reset() {
    log('info', 'reset called');
    state = { data: null, loading: true, error: null };
    notify();
  }

  // ============================================
  // Data Validation
  // ============================================

  function validateToolOutput(data, source) {
    var errors = [];

    if (data === undefined) {
      errors.push('toolOutput is undefined');
    } else if (data === null) {
      // null is valid initial state from OpenAI
      log('info', 'toolOutput is null (OpenAI initial state)', { source: source });
      return { valid: false, errors: ['initial_state'], isInitial: true };
    }

    if (typeof data === 'object' && data !== null) {
      if (data.isError === true) {
        errors.push('Tool returned error: ' + JSON.stringify(data));
      }
      // Check for MCP error structure
      if (data.error && data.error.code) {
        errors.push('MCP error: code=' + data.error.code + ', message=' + (data.error.message || 'unknown'));
      }
    }

    if (errors.length > 0) {
      log('warn', 'Validation issues', { source: source, errors: errors });
    }

    return { valid: errors.length === 0, errors: errors, isInitial: false };
  }

  function validateMetadata(meta, source) {
    var errors = [];

    if (!meta) {
      errors.push('toolResponseMetadata is null/undefined');
      return { valid: false, errors: errors };
    }

    if (typeof meta !== 'object') {
      errors.push('toolResponseMetadata is not an object: ' + typeof meta);
      return { valid: false, errors: errors };
    }

    var html = meta['ui/html'];
    if (html !== undefined) {
      if (typeof html !== 'string') {
        errors.push('ui/html is not a string: ' + typeof html);
      } else if (html.length === 0) {
        errors.push('ui/html is empty string');
      } else if (html.indexOf('validation-error') > -1) {
        errors.push('ui/html contains validation error');
        log('warn', 'HTML contains validation error', { htmlPreview: html.substring(0, 500) });
      }
    }

    if (errors.length > 0) {
      log('warn', 'Metadata validation issues', { source: source, errors: errors, keys: Object.keys(meta) });
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // ============================================
  // OpenAI Platform Interceptors
  // ============================================

  var openaiIntercepted = false;

  function checkOpenAIData(openai) {
    if (!openai) {
      log('warn', 'checkOpenAIData: openai object is null');
      return false;
    }

    log('info', 'checkOpenAIData called', {
      hasToolOutput: openai.toolOutput !== undefined,
      hasToolResponseMetadata: openai.toolResponseMetadata !== undefined,
      toolOutputType: typeof openai.toolOutput,
      metadataKeys: openai.toolResponseMetadata ? Object.keys(openai.toolResponseMetadata) : []
    });

    // Priority 1: Pre-rendered HTML from toolResponseMetadata
    if (openai.toolResponseMetadata) {
      var metaValidation = validateMetadata(openai.toolResponseMetadata, 'openai.toolResponseMetadata');
      var html = openai.toolResponseMetadata['ui/html'];
      if (html && typeof html === 'string') {
        log('info', 'Using ui/html from metadata', { htmlLength: html.length });
        setData(html);
        return true;
      }
    }

    // Priority 2: Tool output (skip null - that's OpenAI's initial state)
    if (openai.toolOutput !== undefined && openai.toolOutput !== null) {
      var outputValidation = validateToolOutput(openai.toolOutput, 'openai.toolOutput');
      if (!outputValidation.isInitial) {
        log('info', 'Using toolOutput', {
          valid: outputValidation.valid,
          errors: outputValidation.errors
        });
        setData(openai.toolOutput);
        return true;
      }
    }

    log('info', 'checkOpenAIData: no data found yet');
    return false;
  }

  function installPropertyInterceptor(obj, prop, onSet) {
    var current = obj[prop];
    var descriptor = Object.getOwnPropertyDescriptor(obj, prop);

    // Don't re-intercept
    if (descriptor && descriptor.get && descriptor.set) return;

    Object.defineProperty(obj, prop, {
      get: function() { return current; },
      set: function(val) {
        current = val;
        onSet(val);
      },
      enumerable: true,
      configurable: true
    });
  }

  function installOpenAIInterceptors(openai) {
    if (!openai || openaiIntercepted) return;
    openaiIntercepted = true;

    // Check existing data first
    if (checkOpenAIData(openai)) return;

    // Intercept toolOutput
    installPropertyInterceptor(openai, 'toolOutput', function(val) {
      checkOpenAIData(openai);
    });

    // Intercept toolResponseMetadata
    installPropertyInterceptor(openai, 'toolResponseMetadata', function(val) {
      checkOpenAIData(openai);
    });
  }

  // Install interceptor on window.openai
  if (typeof window.openai !== 'undefined') {
    installOpenAIInterceptors(window.openai);
  } else {
    // OpenAI object doesn't exist yet - wait for it
    var pendingOpenai = undefined;
    Object.defineProperty(window, 'openai', {
      get: function() { return pendingOpenai; },
      set: function(val) {
        pendingOpenai = val;
        if (val) installOpenAIInterceptors(val);
      },
      enumerable: true,
      configurable: true
    });
  }

  // ============================================
  // MCP/Generic Platform Support
  // ============================================

  // Check for existing __frontmcp.toolOutput
  if (window.__frontmcp && window.__frontmcp.toolOutput !== undefined) {
    setData(window.__frontmcp.toolOutput);
  }

  // Check for __mcpToolOutput
  if (window.__mcpToolOutput !== undefined && window.__mcpToolOutput !== null) {
    setData(window.__mcpToolOutput);
  }

  // Check for __mcpResponseMeta
  if (window.__mcpResponseMeta && window.__mcpResponseMeta['ui/html']) {
    setData(window.__mcpResponseMeta['ui/html']);
  }

  // ============================================
  // Bridge API
  // ============================================

  window.__frontmcp = window.__frontmcp || {};

  window.__frontmcp.bridge = {
    getState: function() { return state; },

    // React useSyncExternalStore compatible
    getSnapshot: function() { return state; },
    getServerSnapshot: function() { return { data: null, loading: true, error: null }; },

    subscribe: function(callback) {
      subscribers.push(callback);
      return function() {
        var idx = subscribers.indexOf(callback);
        if (idx > -1) subscribers.splice(idx, 1);
      };
    },

    hasData: function() { return !state.loading && state.data !== null; },

    // Manual control (for testing/custom injection)
    setData: setData,
    setError: setError,
    reset: reset,

    // Debug API
    debug: {
      getLogs: function() { return debugLog.slice(); },
      getLastErrors: function() {
        return debugLog.filter(function(e) { return e.level === 'error' || e.level === 'warn'; });
      },
      enableDebug: function() {
        DEBUG = true;
        window.localStorage.setItem('frontmcp_debug', '1');
        console.log('[frontmcp] Debug mode enabled. Reload page to see all logs.');
      },
      disableDebug: function() {
        DEBUG = false;
        window.localStorage.removeItem('frontmcp_debug');
      },
      isDebugEnabled: function() { return DEBUG; },
      getStateHistory: function() {
        return {
          current: state,
          version: stateVersion,
          subscriberCount: subscribers.length,
          openaiIntercepted: openaiIntercepted,
          pollCount: pollCount
        };
      },
      dumpAll: function() {
        console.group('[frontmcp] Debug Dump');
        console.log('State:', state);
        console.log('Version:', stateVersion);
        console.log('Subscribers:', subscribers.length);
        console.log('OpenAI Intercepted:', openaiIntercepted);
        console.log('Poll Count:', pollCount);
        console.log('Debug Logs:', debugLog);
        console.groupEnd();
        return {
          state: state,
          logs: debugLog,
          version: stateVersion,
          openaiIntercepted: openaiIntercepted
        };
      }
    }
  };

  // ============================================
  // Fallback Polling (for platforms that don't trigger setters)
  // ============================================

  var pollCount = 0;
  var maxPolls = 30;  // ~3 seconds with exponential backoff

  function pollForData() {
    if (state.data !== null || pollCount >= maxPolls) return;
    pollCount++;

    // Check all sources
    if (window.openai) {
      if (checkOpenAIData(window.openai)) return;
    }

    // Use getToolOutput if available
    if (window.__frontmcp.getToolOutput) {
      var data = window.__frontmcp.getToolOutput();
      if (data !== undefined && data !== null) {
        setData(data);
        return;
      }
    }

    // Exponential backoff: 50ms, 75ms, 112ms, ...
    var delay = Math.min(50 * Math.pow(1.5, Math.min(pollCount, 10)), 500);
    setTimeout(pollForData, delay);
  }

  // Start polling after a brief delay (give interceptors time to fire)
  setTimeout(pollForData, 50);
})();
</script>`;
}

/**
 * Generate TypeScript types for the bridge (for documentation/IDE support).
 */
export const BRIDGE_TYPES = `
interface BridgeState<T = unknown> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface PlatformBridge<T = unknown> {
  getState(): BridgeState<T>;
  subscribe(callback: () => void): () => void;
  getSnapshot(): BridgeState<T>;
  getServerSnapshot(): BridgeState<T>;
  hasData(): boolean;
  setData(data: T): void;
  setError(error: string): void;
  reset(): void;
}

declare global {
  interface Window {
    __frontmcp: {
      bridge: PlatformBridge;
      // ... other __frontmcp methods
    };
  }
}
`;
