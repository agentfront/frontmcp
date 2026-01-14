/**
 * LeftMasterPanel - Compact master view for left panel
 *
 * Shows:
 * - Server status and info
 * - Quick statistics
 * - Scope tree (collapsible based on height)
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { DashboardState } from '../../store/types.js';
import { renderAsciiTree } from '../../utils/ascii-tree.js';

export interface LeftMasterPanelProps {
  state: DashboardState;
  /** Whether to use compact mode (less detail) */
  compact?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ServerStatus({ state }: { state: DashboardState }): React.ReactElement {
  const { serverStatus, serverInfo, connectionStatus } = state;

  const statusColor = {
    starting: 'yellow',
    running: 'green',
    error: 'red',
    stopped: 'gray',
    reloading: 'yellow',
  }[serverStatus] as 'yellow' | 'green' | 'red' | 'gray';

  const connColor = {
    disconnected: 'red',
    connecting: 'yellow',
    connected: 'green',
  }[connectionStatus] as 'red' | 'yellow' | 'green';

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        Server
      </Text>
      <Text>
        <Text dimColor>Status: </Text>
        <Text color={statusColor}>{serverStatus}</Text>
      </Text>
      {serverInfo && (
        <Text>
          <Text dimColor>Name: </Text>
          <Text>{serverInfo.name}</Text>
        </Text>
      )}
      <Text>
        <Text dimColor>Connection: </Text>
        <Text color={connColor}>{connectionStatus}</Text>
      </Text>
    </Box>
  );
}

function QuickStats({ state }: { state: DashboardState }): React.ReactElement {
  const { sessions, requests, registryStats } = state;
  const activeSessions = Array.from(sessions.values()).filter((s) => s.status === 'active').length;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        Stats
      </Text>
      <Text>
        <Text dimColor>Sessions: </Text>
        <Text color="green">{activeSessions}</Text>
        <Text dimColor>/{sessions.size}</Text>
      </Text>
      <Text>
        <Text dimColor>Requests: </Text>
        <Text>{requests.length}</Text>
      </Text>
      <Text>
        <Text dimColor>Tools: </Text>
        <Text color="blue">{registryStats.toolCount}</Text>
        <Text dimColor> Res: </Text>
        <Text color="yellow">{registryStats.resourceCount}</Text>
      </Text>
    </Box>
  );
}

function ScopeTreeSection({ state, compact }: { state: DashboardState; compact?: boolean }): React.ReactElement {
  if (!state.scopeGraph) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="cyan">
          Scope
        </Text>
        <Text dimColor>Waiting for scope...</Text>
      </Box>
    );
  }

  const lines = renderAsciiTree(state.scopeGraph, { showIcons: !compact });
  const maxLines = compact ? 5 : 15;
  const displayLines = lines.slice(0, maxLines);
  const hasMore = lines.length > maxLines;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        Scope
      </Text>
      {displayLines.map((line, i) => (
        <Text key={i} wrap="truncate">
          {line}
        </Text>
      ))}
      {hasMore && <Text dimColor>... +{lines.length - maxLines} more</Text>}
    </Box>
  );
}

function TypeCheckStatus({ state }: { state: DashboardState }): React.ReactElement {
  const { typeCheckStatus, watchStatus } = state;

  const typeColor = {
    idle: 'gray',
    checking: 'yellow',
    pass: 'green',
    fail: 'red',
  }[typeCheckStatus] as 'gray' | 'yellow' | 'green' | 'red';

  const watchColor = {
    idle: 'gray',
    compiling: 'yellow',
    ready: 'green',
    error: 'red',
  }[watchStatus] as 'gray' | 'yellow' | 'green' | 'red';

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        Build
      </Text>
      <Text>
        <Text dimColor>Watch: </Text>
        <Text color={watchColor}>{watchStatus}</Text>
      </Text>
      <Text>
        <Text dimColor>Types: </Text>
        <Text color={typeColor}>{typeCheckStatus}</Text>
      </Text>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Left master panel component.
 */
export function LeftMasterPanel({ state, compact = false }: LeftMasterPanelProps): React.ReactElement {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <ServerStatus state={state} />
      <QuickStats state={state} />
      <TypeCheckStatus state={state} />
      <ScopeTreeSection state={state} compact={compact} />
    </Box>
  );
}
