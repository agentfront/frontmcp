/**
 * StatusBar - Top status bar showing server and connection status
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ServerStatus, WatchStatus, TypeCheckStatus } from '../../store/index.js';

export interface StatusBarProps {
  serverStatus: ServerStatus;
  watchStatus: WatchStatus;
  typeCheckStatus: TypeCheckStatus;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  entryPath: string;
}

function StatusIndicator({
  label,
  status,
  colorMap,
}: {
  label: string;
  status: string;
  colorMap: Record<string, string>;
}): React.ReactElement {
  const color = colorMap[status] || 'gray';
  return (
    <Text>
      <Text dimColor>{label}: </Text>
      <Text color={color as 'green' | 'yellow' | 'red' | 'cyan' | 'gray'}>{status}</Text>
    </Text>
  );
}

export function StatusBar({
  serverStatus,
  watchStatus,
  typeCheckStatus,
  connectionStatus,
  entryPath,
}: StatusBarProps): React.ReactElement {
  const serverColors: Record<string, string> = {
    starting: 'yellow',
    running: 'green',
    error: 'red',
    stopped: 'gray',
    reloading: 'cyan',
  };

  const watchColors: Record<string, string> = {
    idle: 'gray',
    compiling: 'yellow',
    ready: 'green',
    error: 'red',
  };

  const typeCheckColors: Record<string, string> = {
    idle: 'gray',
    checking: 'yellow',
    pass: 'green',
    fail: 'red',
  };

  const connectionColors: Record<string, string> = {
    disconnected: 'red',
    connecting: 'yellow',
    connected: 'green',
  };

  return (
    <Box
      paddingX={1}
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      justifyContent="space-between"
    >
      <Box gap={3}>
        <Text bold color="cyan">
          FrontMCP Dev
        </Text>
        <Text dimColor>{entryPath}</Text>
      </Box>
      <Box gap={3}>
        <StatusIndicator label="server" status={serverStatus} colorMap={serverColors} />
        <StatusIndicator label="watch" status={watchStatus} colorMap={watchColors} />
        <StatusIndicator label="types" status={typeCheckStatus} colorMap={typeCheckColors} />
        <StatusIndicator label="ipc" status={connectionStatus} colorMap={connectionColors} />
      </Box>
    </Box>
  );
}
