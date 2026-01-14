/**
 * OverviewPanel - Main overview with scope tree, server info, and recent logs
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { DashboardState, DashboardStore } from '../../store/index.js';
import { renderAsciiTree } from '../../utils/ascii-tree.js';

export interface OverviewPanelProps {
  state: DashboardState;
  store: ReturnType<typeof import('../../store/index.js').createDashboardStore>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">
        {title}
      </Text>
      {children}
    </Box>
  );
}

function ServerInfo({ state }: { state: DashboardState }): React.ReactElement {
  const { serverInfo, serverStartTime, registryStats } = state;

  const uptime = serverStartTime ? Math.floor((Date.now() - serverStartTime) / 1000) : 0;

  const formatUptime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>Name: </Text>
        <Text>{serverInfo?.name || 'Unknown'}</Text>
      </Text>
      <Text>
        <Text dimColor>Version: </Text>
        <Text>{serverInfo?.version || '?'}</Text>
      </Text>
      <Text>
        <Text dimColor>Uptime: </Text>
        <Text>{formatUptime(uptime)}</Text>
      </Text>
      <Text>
        <Text dimColor>Tools: </Text>
        <Text color="green">{registryStats.toolCount}</Text>
        <Text dimColor> Resources: </Text>
        <Text color="blue">{registryStats.resourceCount}</Text>
        <Text dimColor> Prompts: </Text>
        <Text color="yellow">{registryStats.promptCount}</Text>
      </Text>
      <Text>
        <Text dimColor>Sessions: </Text>
        <Text>{state.sessions.size}</Text>
        <Text dimColor> Requests: </Text>
        <Text>{state.requests.length}</Text>
      </Text>
    </Box>
  );
}

function ScopeTree({ state }: { state: DashboardState }): React.ReactElement {
  if (!state.scopeGraph) {
    return <Text dimColor>Waiting for scope graph...</Text>;
  }

  const lines = renderAsciiTree(state.scopeGraph, { showIcons: true });

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}

function RecentLogs({ state }: { state: DashboardState }): React.ReactElement {
  const recentLogs = state.logs.slice(-10);

  if (recentLogs.length === 0) {
    return <Text dimColor>No logs yet</Text>;
  }

  const getLevelColor = (level: string): 'red' | 'yellow' | 'green' | 'cyan' | 'gray' => {
    switch (level) {
      case 'error':
        return 'red';
      case 'warn':
        return 'yellow';
      case 'info':
        return 'cyan';
      case 'debug':
        return 'gray';
      default:
        return 'gray';
    }
  };

  return (
    <Box flexDirection="column">
      {recentLogs.map((log) => (
        <Text key={log.id} wrap="truncate">
          <Text color={getLevelColor(log.level)}>[{log.level}]</Text>
          {log.source && <Text dimColor> [{log.source}]</Text>}
          <Text> {log.message}</Text>
        </Text>
      ))}
    </Box>
  );
}

export function OverviewPanel({ state }: OverviewPanelProps): React.ReactElement {
  return (
    <Box flexDirection="row" gap={2}>
      {/* Left side - Scope Tree */}
      <Box flexDirection="column" width="40%" borderStyle="round" paddingX={1}>
        <Section title="Scope Graph">
          <ScopeTree state={state} />
        </Section>
      </Box>

      {/* Right side - Server Info and Logs */}
      <Box flexDirection="column" flexGrow={1}>
        <Box borderStyle="round" paddingX={1} marginBottom={1}>
          <Section title="Server Info">
            <ServerInfo state={state} />
          </Section>
        </Box>

        <Box borderStyle="round" paddingX={1} flexGrow={1}>
          <Section title="Recent Logs">
            <RecentLogs state={state} />
          </Section>
        </Box>
      </Box>
    </Box>
  );
}
