/**
 * useLogSearch - Search mode for filtering logs
 *
 * Provides search functionality:
 * - / to activate search mode
 * - Type to filter
 * - n/N for next/prev result
 * - Escape to cancel
 * - Enter to confirm and stay at result
 */

import { useInput } from 'ink';
import type { DashboardStore } from '../store/types.js';

export interface UseLogSearchOptions {
  /** Whether to handle input */
  enabled?: boolean;
  /** Callback when search is confirmed */
  onConfirm?: (query: string) => void;
  /** Callback when search is cancelled */
  onCancel?: () => void;
}

/**
 * Hook to provide search functionality.
 *
 * @param store - The dashboard store
 * @param options - Configuration options
 */
export function useLogSearch(
  store: Pick<
    DashboardStore,
    | 'searchState'
    | 'startSearch'
    | 'updateSearchQuery'
    | 'nextSearchResult'
    | 'prevSearchResult'
    | 'endSearch'
    | 'showHelp'
  >,
  options: UseLogSearchOptions = {},
): void {
  const { enabled = true, onConfirm, onCancel } = options;

  useInput(
    (input, key) => {
      // Don't handle if help is shown
      if (store.showHelp) {
        return;
      }

      const { searchState } = store;

      if (searchState.active) {
        // Search mode is active

        // Escape - cancel search
        if (key.escape) {
          store.endSearch();
          onCancel?.();
          return;
        }

        // Enter - confirm search
        if (key.return) {
          onConfirm?.(searchState.query);
          store.endSearch();
          return;
        }

        // n - next result
        if (input === 'n' && !key.ctrl) {
          store.nextSearchResult();
          return;
        }

        // N - previous result
        if (input === 'N') {
          store.prevSearchResult();
          return;
        }

        // Backspace - remove last character
        if (key.backspace || key.delete) {
          const newQuery = searchState.query.slice(0, -1);
          store.updateSearchQuery(newQuery);
          return;
        }

        // Regular character input - add to query
        if (input && input.length === 1 && !key.ctrl && !key.meta) {
          store.updateSearchQuery(searchState.query + input);
          return;
        }
      } else {
        // Search mode is not active

        // / - start search
        if (input === '/') {
          store.startSearch();
          return;
        }
      }
    },
    { isActive: enabled },
  );
}

/**
 * Filter logs based on search query.
 *
 * @param logs - Array of log entries
 * @param query - Search query string
 * @returns Filtered logs and their original indices
 */
export function filterLogs<T extends { message: string; id: string }>(
  logs: T[],
  query: string,
): { logs: T[]; matchingIds: string[] } {
  if (!query.trim()) {
    return { logs, matchingIds: logs.map((l) => l.id) };
  }

  const lowerQuery = query.toLowerCase();
  const filtered = logs.filter((log) => log.message.toLowerCase().includes(lowerQuery));

  return {
    logs: filtered,
    matchingIds: filtered.map((l) => l.id),
  };
}
