/**
 * useVimNavigation - Vim-style list navigation
 *
 * Provides navigation within lists using:
 * - j/k or Down/Up arrows for single item navigation
 * - g/G for jumping to top/bottom
 * - Ctrl+D/Ctrl+U for half-page scrolling
 */

import { useInput } from 'ink';
import type { DashboardStore } from '../store/types.js';

export interface UseVimNavigationOptions {
  /** Whether to handle input (can be disabled during search mode) */
  enabled?: boolean;
  /** Callback when an item is selected */
  onSelect?: (index: number) => void;
}

/**
 * Hook to provide vim-style list navigation.
 *
 * @param store - The dashboard store
 * @param options - Configuration options
 */
export function useVimNavigation(
  store: Pick<
    DashboardStore,
    | 'scrollUp'
    | 'scrollDown'
    | 'pageUp'
    | 'pageDown'
    | 'scrollToTop'
    | 'scrollToBottom'
    | 'searchState'
    | 'showHelp'
    | 'panelFocus'
  >,
  options: UseVimNavigationOptions = {},
): void {
  const { enabled = true, onSelect } = options;

  useInput(
    (input, key) => {
      // Don't handle input if search mode is active, help is shown, or left panel has focus
      if (store.searchState.active || store.showHelp || store.panelFocus === 'left') {
        return;
      }

      // j or Down arrow - move down
      if (input === 'j' || key.downArrow) {
        store.scrollDown();
        return;
      }

      // k or Up arrow - move up
      if (input === 'k' || key.upArrow) {
        store.scrollUp();
        return;
      }

      // g - jump to top
      if (input === 'g') {
        store.scrollToTop();
        return;
      }

      // G - jump to bottom
      if (input === 'G') {
        store.scrollToBottom();
        return;
      }

      // Ctrl+D - page down (half page)
      if (key.ctrl && input === 'd') {
        store.pageDown();
        return;
      }

      // Ctrl+U - page up (half page)
      if (key.ctrl && input === 'u') {
        store.pageUp();
        return;
      }
    },
    { isActive: enabled },
  );
}
