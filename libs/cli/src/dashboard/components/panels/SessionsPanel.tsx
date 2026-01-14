/**
 * SessionsPanel - Active sessions list and details
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { DashboardState, SessionInfo } from '../../store/index.js';

export interface SessionsPanelProps {
  state: DashboardState;
  store: ReturnType<typeof import('../../store/index.js').createDashboardStore>;
}

function SessionRow({ session, isSelected }: { session: SessionInfo; isSelected: boolean }): React.ReactElement {
  const statusColor = session.status === 'active' ? 'green' : session.status === 'idle' ? 'yellow' : 'red';

  const ago = Math.floor((Date.now() - session.lastActivityAt) / 1000);
  const agoText = ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`;

  return (
    <Box gap={2}>
      <Text color={isSelected ? 'cyan' : undefined}>{isSelected ? '>' : ' '}</Text>
      <Text color={statusColor}>{session.status.padEnd(12)}</Text>
      <Text>{session.id.slice(0, 20)}...</Text>
      <Text dimColor>{session.platformType || 'unknown'}</Text>
      <Text dimColor>{agoText}</Text>
      <Text>
        <Text dimColor>calls:</Text> {session.requestCount}
      </Text>
    </Box>
  );
}

function SessionDetail({ session }: { session: SessionInfo }): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        Session Details
      </Text>
      <Text>
        <Text dimColor>ID: </Text>
        <Text>{session.id}</Text>
      </Text>
      <Text>
        <Text dimColor>Status: </Text>
        <Text color={session.status === 'active' ? 'green' : 'yellow'}>{session.status}</Text>
      </Text>
      <Text>
        <Text dimColor>Transport: </Text>
        <Text>{session.transportType || 'unknown'}</Text>
      </Text>
      <Text>
        <Text dimColor>Platform: </Text>
        <Text>{session.platformType || 'unknown'}</Text>
      </Text>
      {session.clientInfo && (
        <Text>
          <Text dimColor>Client: </Text>
          <Text>
            {session.clientInfo.name} v{session.clientInfo.version}
          </Text>
        </Text>
      )}
      <Text>
        <Text dimColor>Created: </Text>
        <Text>{new Date(session.createdAt).toLocaleTimeString()}</Text>
      </Text>
      <Text>
        <Text dimColor>Last Activity: </Text>
        <Text>{new Date(session.lastActivityAt).toLocaleTimeString()}</Text>
      </Text>
      <Text>
        <Text dimColor>Requests: </Text>
        <Text>{session.requestCount}</Text>
      </Text>
      <Text>
        <Text dimColor>Tool Calls: </Text>
        <Text>{session.toolCallCount}</Text>
      </Text>
    </Box>
  );
}

export function SessionsPanel({ state, store }: SessionsPanelProps): React.ReactElement {
  const sessions = Array.from(state.sessions.values());
  const selectedSession = state.selectedSessionId ? state.sessions.get(state.selectedSessionId) : undefined;

  if (sessions.length === 0) {
    return (
      <Box padding={1}>
        <Text dimColor>No active sessions. Connect a client to see sessions here.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" gap={2}>
      {/* Session list */}
      <Box flexDirection="column" width="60%" borderStyle="round" paddingX={1}>
        <Text bold color="cyan">
          Active Sessions ({sessions.length})
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} isSelected={session.id === state.selectedSessionId} />
          ))}
        </Box>
      </Box>

      {/* Session detail */}
      <Box flexDirection="column" flexGrow={1} borderStyle="round">
        {selectedSession ? (
          <SessionDetail session={selectedSession} />
        ) : (
          <Box padding={1}>
            <Text dimColor>Select a session to view details</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
