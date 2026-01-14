/**
 * useTerminalSize - Track terminal dimensions and update store
 *
 * Uses Ink's useStdout hook to get terminal dimensions and
 * updates the store when the terminal is resized.
 */

import { useEffect } from 'react';
import { useStdout } from 'ink';
import type { DashboardStore } from '../store/types.js';

export interface UseTerminalSizeOptions {
  /** Minimum width before compact mode */
  compactWidthThreshold?: number;
  /** Minimum height before compact mode */
  compactHeightThreshold?: number;
}

export interface TerminalSizeInfo {
  width: number;
  height: number;
  isCompact: boolean;
  isNarrow: boolean;
  isShort: boolean;
}

const DEFAULT_OPTIONS: UseTerminalSizeOptions = {
  compactWidthThreshold: 100,
  compactHeightThreshold: 30,
};

/**
 * Hook to track terminal size and update store.
 *
 * @param store - The dashboard store
 * @param options - Configuration options
 * @returns Terminal size information
 */
export function useTerminalSize(
  store: Pick<DashboardStore, 'setTerminalSize' | 'terminalWidth' | 'terminalHeight'>,
  options: UseTerminalSizeOptions = {},
): TerminalSizeInfo {
  const { stdout } = useStdout();
  const { compactWidthThreshold, compactHeightThreshold } = { ...DEFAULT_OPTIONS, ...options };

  useEffect(() => {
    const updateSize = () => {
      const width = stdout?.columns ?? 120;
      const height = stdout?.rows ?? 40;
      store.setTerminalSize(width, height);
    };

    // Initial update
    updateSize();

    // Listen for resize events
    if (stdout) {
      stdout.on('resize', updateSize);
      return () => {
        stdout.off('resize', updateSize);
      };
    }

    // No cleanup needed if stdout is not available
    return undefined;
  }, [stdout, store]);

  const width = store.terminalWidth;
  const height = store.terminalHeight;
  const isNarrow = width < (compactWidthThreshold ?? 100);
  const isShort = height < (compactHeightThreshold ?? 30);

  return {
    width,
    height,
    isCompact: isNarrow || isShort,
    isNarrow,
    isShort,
  };
}
