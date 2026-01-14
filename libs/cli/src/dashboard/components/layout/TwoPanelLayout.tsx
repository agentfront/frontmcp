/**
 * TwoPanelLayout - Two-column layout with focus indicators
 *
 * Renders a master-detail layout with:
 * - Left panel (master): compact overview
 * - Right panel (detail): tabbed content area
 * - Visual focus indicators via border colors
 */

import React from 'react';
import { Box } from 'ink';
import type { PanelFocus } from '../../store/types.js';

export interface TwoPanelLayoutProps {
  /** Content for the left panel */
  leftPanel: React.ReactNode;
  /** Content for the right panel */
  rightPanel: React.ReactNode;
  /** Width of the left panel (e.g., '30%', 30) */
  leftWidth?: string | number;
  /** Which panel currently has focus */
  focus: PanelFocus;
  /** Minimum width for the left panel */
  minLeftWidth?: number;
}

/**
 * Two-panel layout component with visual focus indicators.
 */
export function TwoPanelLayout({
  leftPanel,
  rightPanel,
  leftWidth = '30%',
  focus,
  minLeftWidth = 20,
}: TwoPanelLayoutProps): React.ReactElement {
  // Border colors based on focus
  const leftBorderColor = focus === 'left' ? 'cyan' : 'gray';
  const rightBorderColor = focus === 'right' ? 'cyan' : 'gray';

  return (
    <Box flexDirection="row" flexGrow={1} gap={1}>
      {/* Left Panel (Master) */}
      <Box
        flexDirection="column"
        width={leftWidth}
        minWidth={minLeftWidth}
        borderStyle="round"
        borderColor={leftBorderColor}
        paddingX={1}
      >
        {leftPanel}
      </Box>

      {/* Right Panel (Detail) */}
      <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={rightBorderColor} paddingX={1}>
        {rightPanel}
      </Box>
    </Box>
  );
}
