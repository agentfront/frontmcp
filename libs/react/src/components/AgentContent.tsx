/**
 * AgentContent — a component that registers itself as an MCP tool.
 *
 * When an agent calls the tool, the component stores the args and
 * renders them via the `render` prop. Before the first invocation
 * it shows the `fallback`.
 *
 * @deprecated Use `mcpComponent()` instead for type-safe schemas and
 * a cleaner component-wrapping API.
 */

import React, { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { CallToolResult } from '@frontmcp/sdk';
import { useDynamicTool } from '../hooks/useDynamicTool';

/** @deprecated Use `mcpComponent()` instead. */
export interface AgentContentProps {
  /** MCP tool name that agents will call to push data. */
  name: string;
  /** Tool description for agents. */
  description: string;
  /** JSON Schema for the tool's input. */
  inputSchema?: Record<string, unknown>;
  /** Render function — receives the args the agent sent. */
  render: (data: Record<string, unknown>) => ReactNode;
  /** Shown before the agent's first invocation. */
  fallback?: ReactNode;
  /** Target a specific named server. */
  server?: string;
}

/** @deprecated Use `mcpComponent()` instead. */
export function AgentContent({
  name,
  description,
  inputSchema = { type: 'object' },
  render,
  fallback = null,
  server,
}: AgentContentProps): React.ReactElement {
  const [lastData, setLastData] = useState<Record<string, unknown> | null>(null);

  const execute = useCallback(
    async (args: Record<string, unknown>): Promise<CallToolResult> => {
      setLastData(args);
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, rendered: name }) }],
      };
    },
    [name],
  );

  useDynamicTool({ name, description, inputSchema, execute, server });

  return React.createElement(React.Fragment, null, lastData !== null ? render(lastData) : fallback);
}
