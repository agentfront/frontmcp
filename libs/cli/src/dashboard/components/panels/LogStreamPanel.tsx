/**
 * LogStreamPanel - Full-height scrollable log viewer
 *
 * Features:
 * - Real-time log streaming
 * - Scrollable with vim navigation
 * - Search/filter support
 * - Virtual rendering for performance
 * - Scroll position indicator
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { DashboardState, LogEntry, ScrollState, SearchState } from '../../store/types.js';

export interface LogStreamPanelProps {
  state: DashboardState;
  /** Current scroll state for logs */
  scrollState: ScrollState;
  /** Current search state */
  searchState: SearchState;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getLevelColor(level: string): 'red' | 'yellow' | 'cyan' | 'gray' | 'green' | 'white' {
  switch (level) {
    case 'error':
    case 'stderr':
      return 'red';
    case 'warn':
      return 'yellow';
    case 'info':
      return 'cyan';
    case 'debug':
      return 'gray';
    case 'stdout':
      return 'white';
    default:
      return 'gray';
  }
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function filterLogs(logs: LogEntry[], query: string): LogEntry[] {
  if (!query.trim()) return logs;
  const lowerQuery = query.toLowerCase();
  return logs.filter(
    (log) =>
      log.message.toLowerCase().includes(lowerQuery) ||
      log.source?.toLowerCase().includes(lowerQuery) ||
      log.level.toLowerCase().includes(lowerQuery),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SearchBar({ query }: { query: string }): React.ReactElement {
  return (
    <Box paddingX={1} marginBottom={1}>
      <Text>
        <Text color="cyan">/</Text>
        <Text>{query}</Text>
        <Text color="gray">|</Text>
      </Text>
    </Box>
  );
}

function LogLine({
  log,
  isSelected,
  highlight,
}: {
  log: LogEntry;
  isSelected?: boolean;
  highlight?: string;
}): React.ReactElement {
  const levelColor = getLevelColor(log.level);
  const timestamp = formatTimestamp(log.timestamp);

  // Highlight matching text if search is active
  let messageContent: React.ReactNode = log.message;
  if (highlight && highlight.trim()) {
    const lowerMessage = log.message.toLowerCase();
    const lowerHighlight = highlight.toLowerCase();
    const idx = lowerMessage.indexOf(lowerHighlight);
    if (idx !== -1) {
      const before = log.message.slice(0, idx);
      const match = log.message.slice(idx, idx + highlight.length);
      const after = log.message.slice(idx + highlight.length);
      messageContent = (
        <>
          {before}
          <Text backgroundColor="yellow" color="black">
            {match}
          </Text>
          {after}
        </>
      );
    }
  }

  return (
    <Box>
      {isSelected && <Text color="cyan">{' > '}</Text>}
      {!isSelected && <Text>{'   '}</Text>}
      <Text dimColor>{timestamp} </Text>
      <Text color={levelColor}>[{log.level.slice(0, 3).toUpperCase()}]</Text>
      {log.source && <Text dimColor> [{log.source}]</Text>}
      <Text> {messageContent}</Text>
    </Box>
  );
}

function EmptyState(): React.ReactElement {
  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      <Text dimColor>No logs yet</Text>
      <Text dimColor>Server output will appear here</Text>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log stream panel component.
 */
export function LogStreamPanel({ state, scrollState, searchState }: LogStreamPanelProps): React.ReactElement {
  // Filter logs based on search query
  const filteredLogs = useMemo(() => filterLogs(state.logs, searchState.query), [state.logs, searchState.query]);

  // Calculate visible logs based on scroll state
  const visibleLogs = useMemo(() => {
    const { offset, viewportHeight } = scrollState;
    return filteredLogs.slice(offset, offset + viewportHeight);
  }, [filteredLogs, scrollState.offset, scrollState.viewportHeight]);

  if (filteredLogs.length === 0 && !searchState.active) {
    return <EmptyState />;
  }

  // Calculate padding lines to push content to bottom when there are fewer logs than viewport
  const paddingLines = Math.max(0, scrollState.viewportHeight - visibleLogs.length);

  return (
    <Box flexDirection="column" flexGrow={1} height={scrollState.viewportHeight + 2}>
      {/* Search bar when active */}
      {searchState.active && <SearchBar query={searchState.query} />}

      {/* Padding to push logs to bottom */}
      {paddingLines > 0 && <Box height={paddingLines} />}

      {/* Log entries */}
      <Box flexDirection="column">
        {visibleLogs.map((log, index) => {
          const absoluteIndex = scrollState.offset + index;
          const isSelected = absoluteIndex === scrollState.selectedIndex;

          return (
            <LogLine
              key={log.id}
              log={log}
              isSelected={isSelected}
              highlight={searchState.active ? searchState.query : undefined}
            />
          );
        })}

        {/* Show message if search has no results */}
        {filteredLogs.length === 0 && searchState.active && (
          <Box justifyContent="center" marginTop={1}>
            <Text dimColor>No matches for "{searchState.query}"</Text>
          </Box>
        )}
      </Box>

      {/* Scroll indicator with auto-scroll status */}
      {filteredLogs.length > 0 && (
        <Box justifyContent="space-between" paddingX={1}>
          <Text dimColor>
            {scrollState.autoScroll ? (
              <Text color="green">LIVE</Text>
            ) : (
              <Text color="yellow">PAUSED (G to resume)</Text>
            )}
          </Text>
          <Text dimColor>
            {scrollState.offset + 1}-{Math.min(scrollState.offset + visibleLogs.length, filteredLogs.length)} of{' '}
            {filteredLogs.length}
          </Text>
        </Box>
      )}
    </Box>
  );
}
