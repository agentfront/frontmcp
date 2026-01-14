/**
 * ApiPanel - All API requests (not just tool calls)
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { DashboardState, RequestInfo } from '../../store/index.js';

export interface ApiPanelProps {
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

function getFlowShortName(flowName: string): string {
  const parts = flowName.split(':');
  return parts[parts.length - 1] || flowName;
}

function RequestRow({ request, isSelected }: { request: RequestInfo; isSelected: boolean }): React.ReactElement {
  const statusColor = request.status === 'complete' ? 'green' : request.status === 'error' ? 'red' : 'yellow';
  const statusIcon = request.status === 'complete' ? '✓' : request.status === 'error' ? '✗' : '…';

  const duration = request.durationMs ? `${request.durationMs}ms` : '...';
  const time = new Date(request.startTime).toLocaleTimeString();
  const flowShort = getFlowShortName(request.flowName);

  return (
    <Box gap={1}>
      <Text color={isSelected ? 'cyan' : undefined}>{isSelected ? '>' : ' '}</Text>
      <Text color={statusColor}>{statusIcon}</Text>
      <Text color="blue">{flowShort.padEnd(20)}</Text>
      <Text>{(request.entryName || '-').slice(0, 20).padEnd(20)}</Text>
      <Text dimColor>{duration.padStart(8)}</Text>
      <Text dimColor>{time}</Text>
    </Box>
  );
}

function RequestDetail({ request }: { request: RequestInfo }): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        Request Details
      </Text>

      <Text>
        <Text dimColor>Flow: </Text>
        <Text color="blue">{request.flowName}</Text>
      </Text>
      <Text>
        <Text dimColor>Entry: </Text>
        <Text>{request.entryName || '-'}</Text>
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
        <Text dimColor>Request ID: </Text>
        <Text>{request.requestId}</Text>
      </Text>
      {request.sessionId && (
        <Text>
          <Text dimColor>Session: </Text>
          <Text>{request.sessionId.slice(0, 30)}...</Text>
        </Text>
      )}

      {request.requestBody !== undefined && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            Request Body:
          </Text>
          <Box borderStyle="single" paddingX={1}>
            <Text>{formatJson(request.requestBody, 500)}</Text>
          </Box>
        </Box>
      )}

      {request.error && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="red">
            Error:
          </Text>
          <Box borderStyle="single" paddingX={1} borderColor="red">
            <Text color="red">
              {request.error.name}: {request.error.message}
              {request.error.code && ` (code: ${request.error.code})`}
            </Text>
          </Box>
        </Box>
      )}

      {request.responseBody !== undefined && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            Response Body:
          </Text>
          <Box borderStyle="single" paddingX={1}>
            <Text>{formatJson(request.responseBody, 500)}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

export function ApiPanel({ state }: ApiPanelProps): React.ReactElement {
  const recentRequests = state.requests.slice(-30).reverse();

  const selectedRequest = state.selectedRequestId
    ? state.requests.find((r) => r.id === state.selectedRequestId)
    : undefined;

  // Group by status for stats
  const pending = state.requests.filter((r) => r.status === 'pending').length;
  const complete = state.requests.filter((r) => r.status === 'complete').length;
  const errors = state.requests.filter((r) => r.status === 'error').length;

  return (
    <Box flexDirection="row" gap={2}>
      {/* Request list */}
      <Box flexDirection="column" width="55%" borderStyle="round" paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color="cyan">
            API Requests ({state.requests.length})
          </Text>
          <Text>
            <Text color="yellow">{pending}⏳</Text> <Text color="green">{complete}✓</Text>{' '}
            <Text color="red">{errors}✗</Text>
          </Text>
        </Box>

        {recentRequests.length === 0 ? (
          <Box marginTop={1}>
            <Text dimColor>No requests yet</Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {recentRequests.map((request) => (
              <RequestRow key={request.id} request={request} isSelected={request.id === state.selectedRequestId} />
            ))}
          </Box>
        )}
      </Box>

      {/* Request detail */}
      <Box flexDirection="column" flexGrow={1} borderStyle="round" overflowY="hidden">
        {selectedRequest ? (
          <RequestDetail request={selectedRequest} />
        ) : (
          <Box padding={1}>
            <Text dimColor>Select a request to view details</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
