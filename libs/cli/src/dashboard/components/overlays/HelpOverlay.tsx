/**
 * HelpOverlay - Keyboard shortcuts help modal
 *
 * Displays all available keyboard shortcuts in a centered modal.
 * Press ? or Esc to close.
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';

export interface HelpOverlayProps {
  /** Callback when overlay should close */
  onClose: () => void;
}

interface KeyBinding {
  key: string;
  action: string;
  category?: string;
}

const KEYBINDINGS: KeyBinding[] = [
  // Navigation
  { key: 'h / Left', action: 'Focus left panel', category: 'Navigation' },
  { key: 'l / Right', action: 'Focus right panel' },
  { key: 'Tab', action: 'Cycle panel focus' },
  { key: '1-5', action: 'Switch right panel tab' },

  // List Navigation
  { key: 'j / Down', action: 'Move down', category: 'List Navigation' },
  { key: 'k / Up', action: 'Move up' },
  { key: 'g', action: 'Jump to top' },
  { key: 'G', action: 'Jump to bottom' },
  { key: 'Ctrl+D', action: 'Half page down' },
  { key: 'Ctrl+U', action: 'Half page up' },

  // Search
  { key: '/', action: 'Start search', category: 'Search' },
  { key: 'n', action: 'Next result' },
  { key: 'N', action: 'Previous result' },
  { key: 'Enter', action: 'Confirm search' },
  { key: 'Escape', action: 'Cancel search / Go back' },

  // Actions
  { key: 'Ctrl+L', action: 'Clear logs', category: 'Actions' },
  { key: '?', action: 'Toggle this help' },
  { key: 'q', action: 'Quit' },
];

/**
 * Help overlay component.
 */
export function HelpOverlay({ onClose }: HelpOverlayProps): React.ReactElement {
  // Handle keyboard input to close
  useInput((input, key) => {
    if (input === '?' || key.escape || input === 'q') {
      onClose();
    }
  });

  let currentCategory = '';

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      marginX={4}
      marginY={1}
    >
      {/* Title */}
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="cyan">
          Keyboard Shortcuts
        </Text>
      </Box>

      {/* Key bindings */}
      <Box flexDirection="column">
        {KEYBINDINGS.map(({ key, action, category }, index) => {
          const showCategory = category && category !== currentCategory;
          if (category) currentCategory = category;

          return (
            <React.Fragment key={key + index}>
              {showCategory && (
                <Box marginTop={index > 0 ? 1 : 0}>
                  <Text bold dimColor>
                    {category}
                  </Text>
                </Box>
              )}
              <Box>
                <Box width={14}>
                  <Text bold color="yellow">
                    {key}
                  </Text>
                </Box>
                <Text>{action}</Text>
              </Box>
            </React.Fragment>
          );
        })}
      </Box>

      {/* Footer */}
      <Box justifyContent="center" marginTop={1}>
        <Text dimColor>Press ? or Esc to close</Text>
      </Box>
    </Box>
  );
}
