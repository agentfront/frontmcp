/**
 * ConfigPanel - Configuration status and diagnostics
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { DashboardState } from '../../store/index.js';

export interface ConfigPanelProps {
  state: DashboardState;
  store: ReturnType<typeof import('../../store/index.js').createDashboardStore>;
}

function StatusBadge({ status }: { status: 'unknown' | 'loaded' | 'error' | 'missing' }): React.ReactElement {
  const colors: Record<string, 'gray' | 'green' | 'red' | 'yellow'> = {
    unknown: 'gray',
    loaded: 'green',
    error: 'red',
    missing: 'yellow',
  };

  const labels: Record<string, string> = {
    unknown: '○ Unknown',
    loaded: '● Loaded',
    error: '✗ Error',
    missing: '! Missing',
  };

  return <Text color={colors[status]}>{labels[status]}</Text>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">
        {title}
      </Text>
      <Box flexDirection="column" marginTop={1} paddingLeft={2}>
        {children}
      </Box>
    </Box>
  );
}

export function ConfigPanel({ state }: ConfigPanelProps): React.ReactElement {
  const { configStatus, registryStats, serverInfo, connectionStatus, connectionMode } = state;

  return (
    <Box flexDirection="column" gap={1}>
      {/* Configuration Status */}
      <Box borderStyle="round" paddingX={1} flexDirection="column">
        <Section title="Configuration Status">
          <Box gap={2}>
            <Text dimColor>Status:</Text>
            <StatusBadge status={configStatus.status} />
          </Box>

          {configStatus.loadedKeys.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>Loaded Keys:</Text>
              {configStatus.loadedKeys.slice(0, 10).map((key) => (
                <Text key={key} color="green">
                  {' '}
                  • {key}
                </Text>
              ))}
              {configStatus.loadedKeys.length > 10 && (
                <Text dimColor> ... and {configStatus.loadedKeys.length - 10} more</Text>
              )}
            </Box>
          )}

          {configStatus.missingKeys.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="yellow">Missing Keys:</Text>
              {configStatus.missingKeys.map((key) => (
                <Text key={key} color="yellow">
                  {' '}
                  • {key}
                </Text>
              ))}
            </Box>
          )}

          {configStatus.errors.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="red">Errors:</Text>
              {configStatus.errors.map((err, i) => (
                <Text key={i} color="red">
                  {' '}
                  • {err.path}: {err.message}
                </Text>
              ))}
            </Box>
          )}
        </Section>
      </Box>

      {/* Server Info */}
      <Box borderStyle="round" paddingX={1} flexDirection="column">
        <Section title="Server Information">
          <Text>
            <Text dimColor>Name: </Text>
            <Text>{serverInfo?.name || 'Unknown'}</Text>
          </Text>
          <Text>
            <Text dimColor>Version: </Text>
            <Text>{serverInfo?.version || '?'}</Text>
          </Text>
          <Text>
            <Text dimColor>Status: </Text>
            <Text color={state.serverStatus === 'running' ? 'green' : 'yellow'}>{state.serverStatus}</Text>
          </Text>
        </Section>
      </Box>

      {/* Registry Stats */}
      <Box borderStyle="round" paddingX={1} flexDirection="column">
        <Section title="Registry Statistics">
          <Box gap={4}>
            <Text>
              <Text dimColor>Tools: </Text>
              <Text color="green">{registryStats.toolCount}</Text>
              <Text dimColor> (v{registryStats.toolVersion})</Text>
            </Text>
            <Text>
              <Text dimColor>Resources: </Text>
              <Text color="blue">{registryStats.resourceCount}</Text>
              <Text dimColor> (v{registryStats.resourceVersion})</Text>
            </Text>
          </Box>
          <Box gap={4}>
            <Text>
              <Text dimColor>Prompts: </Text>
              <Text color="yellow">{registryStats.promptCount}</Text>
              <Text dimColor> (v{registryStats.promptVersion})</Text>
            </Text>
            <Text>
              <Text dimColor>Agents: </Text>
              <Text color="magenta">{registryStats.agentCount}</Text>
              <Text dimColor> (v{registryStats.agentVersion})</Text>
            </Text>
          </Box>
        </Section>
      </Box>

      {/* Connection Info */}
      <Box borderStyle="round" paddingX={1} flexDirection="column">
        <Section title="Dashboard Connection">
          <Text>
            <Text dimColor>Status: </Text>
            <Text
              color={connectionStatus === 'connected' ? 'green' : connectionStatus === 'connecting' ? 'yellow' : 'red'}
            >
              {connectionStatus}
            </Text>
          </Text>
          <Text>
            <Text dimColor>Mode: </Text>
            <Text>{connectionMode}</Text>
          </Text>
          <Box marginTop={1}>
            <Text dimColor>
              The dashboard receives events from the MCP server process via{' '}
              {connectionMode === 'ipc' ? 'IPC channel' : 'stderr parsing'}.
            </Text>
          </Box>
        </Section>
      </Box>
    </Box>
  );
}
