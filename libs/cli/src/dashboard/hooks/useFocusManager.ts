/**
 * useFocusManager - Handle panel focus navigation
 *
 * Manages focus between left and right panels using:
 * - h/l or Left/Right arrow keys for panel switching
 * - Tab/Shift+Tab for cycling
 * - Enter for drill-down
 * - Escape for going back
 */

import { useInput } from 'ink';
import type { DashboardStore, RightPanelTab, PanelFocus } from '../store/types.js';
import { RIGHT_PANEL_TABS } from '../store/types.js';

export interface UseFocusManagerOptions {
  /** Callback when Enter is pressed (drill down) */
  onEnter?: () => void;
  /** Callback when Escape is pressed (go back) */
  onEscape?: () => void;
  /** Whether to handle input (can be disabled during search mode) */
  enabled?: boolean;
}

/**
 * Hook to manage panel focus navigation.
 *
 * @param store - The dashboard store
 * @param options - Configuration options
 */
export function useFocusManager(
  store: Pick<
    DashboardStore,
    'panelFocus' | 'rightPanelTab' | 'setFocus' | 'setRightPanelTab' | 'toggleFocus' | 'searchState' | 'showHelp'
  >,
  options: UseFocusManagerOptions = {},
): void {
  const { onEnter, onEscape, enabled = true } = options;

  useInput(
    (input, key) => {
      // Don't handle input if search mode is active or help is shown
      if (store.searchState.active || store.showHelp) {
        return;
      }

      // h or Left arrow - focus left panel
      if (input === 'h' || key.leftArrow) {
        store.setFocus('left');
        return;
      }

      // l or Right arrow - focus right panel
      if (input === 'l' || key.rightArrow) {
        store.setFocus('right');
        return;
      }

      // Tab - cycle focus
      if (key.tab) {
        if (key.shift) {
          // Shift+Tab - reverse cycle
          store.toggleFocus();
        } else {
          // Tab - forward cycle
          store.toggleFocus();
        }
        return;
      }

      // Number keys 1-5 - switch right panel tab
      if (input >= '1' && input <= '5') {
        const index = parseInt(input) - 1;
        if (index < RIGHT_PANEL_TABS.length) {
          store.setRightPanelTab(RIGHT_PANEL_TABS[index]);
          // Also switch focus to right panel when switching tabs
          store.setFocus('right');
        }
        return;
      }

      // Enter - drill down / select
      if (key.return) {
        onEnter?.();
        return;
      }

      // Escape - go back
      if (key.escape) {
        onEscape?.();
        return;
      }
    },
    { isActive: enabled },
  );
}
