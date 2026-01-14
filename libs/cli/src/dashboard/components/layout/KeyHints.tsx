/**
 * KeyHints - Bottom bar showing keyboard shortcuts
 *
 * Displays context-sensitive key hints based on:
 * - Current panel focus
 * - Search mode status
 * - Help overlay visibility
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface KeyHintsProps {
  /** Whether search mode is active */
  searchActive?: boolean;
  /** Whether to show compact version */
  compact?: boolean;
}

interface KeyHint {
  key: string;
  label: string;
}

const NORMAL_HINTS: KeyHint[] = [
  { key: 'h/l', label: 'Panel' },
  { key: 'j/k', label: 'Nav' },
  { key: '1-5', label: 'Tab' },
  { key: '/', label: 'Search' },
  { key: '?', label: 'Help' },
  { key: 'q', label: 'Quit' },
];

const SEARCH_HINTS: KeyHint[] = [
  { key: 'type', label: 'Filter' },
  { key: 'n/N', label: 'Next/Prev' },
  { key: 'Enter', label: 'Confirm' },
  { key: 'Esc', label: 'Cancel' },
];

const COMPACT_NORMAL_HINTS: KeyHint[] = [
  { key: '?', label: 'Help' },
  { key: 'q', label: 'Quit' },
];

/**
 * Key hints bar component.
 */
export function KeyHints({ searchActive = false, compact = false }: KeyHintsProps): React.ReactElement {
  const hints = searchActive ? SEARCH_HINTS : compact ? COMPACT_NORMAL_HINTS : NORMAL_HINTS;

  return (
    <Box paddingX={1} borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
      <Box gap={2}>
        {hints.map(({ key, label }) => (
          <Text key={key} dimColor>
            <Text bold color="cyan">
              {key}
            </Text>{' '}
            {label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
