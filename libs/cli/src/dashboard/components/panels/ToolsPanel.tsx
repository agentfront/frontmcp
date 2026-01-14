/**
 * ToolsPanel - Tool calls and tool list
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { DashboardState, RequestInfo } from '../../store/index.js';

export interface ToolsPanelProps {
  state: DashboardState;
  store: ReturnType<typeof import('../../store/index.js').createDashboardStore>;
}

function formatJson(value: unknown, maxLen: number): string {
  const str = JSON.stringify(value, null, 2);
  if (str.length > maxLen) {
    return str.slice(0, maxLen) + '...';
  }
  return str;
}

function ToolCallRow({ request, isSelected }: { request: RequestInfo; isSelected: boolean }): React.ReactElement {
  const statusColor = request.status === 'complete' ? 'green' : request.status === 'error' ? 'red' : 'yellow';
  const statusIcon = request.status === 'complete' ? '✓' : request.status === 'error' ? '✗' : '…';

  const duration = request.durationMs ? `${request.durationMs}ms` : '...';
  const time = new Date(request.startTime).toLocaleTimeString();

  return (
    <Box gap={2}>
      <Text color={isSelected ? 'cyan' : undefined}>{isSelected ? '>' : ' '}</Text>
      <Text color={statusColor}>{statusIcon}</Text>
      <Text>{request.entryName || 'unknown'}</Text>
      <Text dimColor>{duration.padStart(8)}</Text>
      <Text dimColor>{time}</Text>
    </Box>
  );
}

function ToolCallDetail({ request }: { request: RequestInfo }): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        Tool Call Details
      </Text>
      <Text>
        <Text dimColor>Tool: </Text>
        <Text>{request.entryName || 'unknown'}</Text>
      </Text>
      <Text>
        <Text dimColor>Status: </Text>
        <Text color={request.status === 'complete' ? 'green' : request.status === 'error' ? 'red' : 'yellow'}>
          {request.status}
        </Text>
      </Text>
      <Text>
        <Text dimColor>Duration: </Text>
        <Text>{request.durationMs ? `${request.durationMs}ms` : 'pending'}</Text>
      </Text>
      <Text>
        <Text dimColor>Started: </Text>
        <Text>{new Date(request.startTime).toLocaleTimeString()}</Text>
      </Text>
      {request.sessionId && (
        <Text>
          <Text dimColor>Session: </Text>
          <Text>{request.sessionId.slice(0, 20)}...</Text>
        </Text>
      )}

      {request.requestBody !== undefined && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            Input:
          </Text>
          <Text>{formatJson(request.requestBody, 200)}</Text>
        </Box>
      )}

      {request.error && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="red">
            Error:
          </Text>
          <Text color="red">{request.error.message}</Text>
        </Box>
      )}

      {request.responseBody !== undefined && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            Output:
          </Text>
          <Text>{formatJson(request.responseBody, 200)}</Text>
        </Box>
      )}
    </Box>
  );
}

export function ToolsPanel({ state }: ToolsPanelProps): React.ReactElement {
  // Filter for tool calls only
  const toolCalls = state.requests.filter((r) => r.flowName === 'tools:call-tool');
  const recentCalls = toolCalls.slice(-20).reverse();

  const selectedRequest = state.selectedRequestId
    ? state.requests.find((r) => r.id === state.selectedRequestId)
    : undefined;

  return (
    <Box flexDirection="row" gap={2}>
      {/* Tool stats and recent calls */}
      <Box flexDirection="column" width="55%" borderStyle="round" paddingX={1}>
        <Text bold color="cyan">
          Tool Calls ({toolCalls.length}) · Tools: {state.registryStats.toolCount}
        </Text>

        {recentCalls.length === 0 ? (
          <Box marginTop={1}>
            <Text dimColor>No tool calls yet</Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {recentCalls.map((request) => (
              <ToolCallRow key={request.id} request={request} isSelected={request.id === state.selectedRequestId} />
            ))}
          </Box>
        )}
      </Box>

      {/* Call detail */}
      <Box flexDirection="column" flexGrow={1} borderStyle="round">
        {selectedRequest ? (
          <ToolCallDetail request={selectedRequest} />
        ) : (
          <Box padding={1}>
            <Text dimColor>Select a tool call to view details</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
