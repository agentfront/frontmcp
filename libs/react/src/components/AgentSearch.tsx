/**
 * AgentSearch — a headless search component powered by an MCP tool.
 *
 * Registers a tool that agents call to execute search queries.
 * Also exposes the current search input value as a dynamic resource
 * so agents can see what the user typed.
 *
 * @deprecated Use `mcpComponent()` with `columns` option for table-based
 * search result rendering.
 */

import React, { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { CallToolResult, ReadResourceResult } from '@frontmcp/sdk';
import { useDynamicTool } from '../hooks/useDynamicTool';
import { useDynamicResource } from '../hooks/useDynamicResource';

export interface SearchInputRenderProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** @deprecated Use `mcpComponent()` with `columns` option instead. */
export interface AgentSearchProps {
  /** MCP tool name agents call to execute searches. */
  toolName: string;
  /** Tool description for agents. */
  description: string;
  /** Input placeholder text. */
  placeholder?: string;
  /** Called with search results when the agent responds. */
  onResults: (results: unknown) => void;
  /** Custom input renderer (headless pattern). Falls back to a plain <input>. */
  renderInput?: (props: SearchInputRenderProps) => ReactNode;
  /** Target a specific named server. */
  server?: string;
}

/** @deprecated Use `mcpComponent()` with `columns` option instead. */
export function AgentSearch({
  toolName,
  description,
  placeholder,
  onResults,
  renderInput,
  server,
}: AgentSearchProps): React.ReactElement {
  const [query, setQuery] = useState('');

  const execute = useCallback(
    async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const results = args['results'] ?? args;
      onResults(results);
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, delivered: true }) }],
      };
    },
    [onResults],
  );

  useDynamicTool({
    name: toolName,
    description,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        results: { type: 'array', description: 'Search results to display' },
      },
    },
    execute,
    server,
  });

  const readQuery = useCallback(
    async (): Promise<ReadResourceResult> => ({
      contents: [{ uri: `search://${toolName}/query`, mimeType: 'text/plain', text: query }],
    }),
    [query, toolName],
  );

  useDynamicResource({
    uri: `search://${toolName}/query`,
    name: `${toolName}-query`,
    description: `Current search query for ${toolName}`,
    mimeType: 'text/plain',
    read: readQuery,
    server,
  });

  const inputProps: SearchInputRenderProps = {
    value: query,
    onChange: setQuery,
    placeholder,
  };

  if (renderInput) {
    return React.createElement(React.Fragment, null, renderInput(inputProps));
  }

  return React.createElement('input', {
    type: 'text',
    value: query,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value),
    placeholder,
  });
}
