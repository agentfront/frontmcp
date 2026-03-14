/**
 * mcpComponent — factory that wraps a React component + zod schema into
 * an MCP-registered component.
 *
 * On mount, registers an MCP tool (via useDynamicTool with zod schema).
 * When the agent calls the tool, data is validated against the zod schema
 * and passed as typed props to the wrapped component.
 *
 * Supports:
 * - Direct component wrapping
 * - Inline function components
 * - Lazy loading via () => import(...)
 * - Table mode (columns option with null component)
 */

import React, { useState, useCallback, Suspense, useMemo } from 'react';
import type { ReactNode, ReactElement, ComponentType } from 'react';
import type { CallToolResult } from '@frontmcp/sdk';
import type { z } from 'zod';
import type { McpColumnDef } from '../types';
import { useDynamicTool } from '../hooks/useDynamicTool';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface McpComponentOptions<S extends z.ZodObject<z.ZodRawShape>> {
  name: string;
  description?: string;
  schema: S;
  fallback?: ReactNode;
  server?: string;
  columns?: McpColumnDef[];
}

export interface McpComponentInstance<Props> extends React.FC<Partial<Props>> {
  toolName: string;
}

type ComponentArg<Props> =
  | ComponentType<Props>
  | ((props: Props) => ReactElement)
  | (() => Promise<{ default: ComponentType<Props> }>)
  | null;

// ─── Default table component ────────────────────────────────────────────────

function DefaultTable({ rows, columns }: { rows: Record<string, unknown>[]; columns: McpColumnDef[] }): ReactElement {
  return React.createElement(
    'table',
    null,
    React.createElement(
      'thead',
      null,
      React.createElement(
        'tr',
        null,
        columns.map((col) => React.createElement('th', { key: col.key }, col.header)),
      ),
    ),
    React.createElement(
      'tbody',
      null,
      rows.map((row, i) =>
        React.createElement(
          'tr',
          { key: i },
          columns.map((col) => {
            const value = row[col.key];
            const rendered = col.render ? col.render(value) : String(value ?? '');
            return React.createElement('td', { key: col.key }, rendered);
          }),
        ),
      ),
    ),
  );
}

// ─── Lazy detection helper ──────────────────────────────────────────────────

function isLazyImport<Props>(fn: ComponentArg<Props>): fn is () => Promise<{ default: ComponentType<Props> }> {
  // Lazy imports are 0-arity functions that are NOT React components
  // (React components receive props as first arg, so length >= 0, but
  // actual components typically have length 1; lazy factories have length 0)
  if (typeof fn !== 'function' || fn === null) return false;
  // If it has a prototype with render method, it's a class component
  if (fn.prototype && fn.prototype.isReactComponent) return false;
  // Check if it's a zero-arg function — heuristic for () => import(...)
  return fn.length === 0;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function mcpComponent<S extends z.ZodObject<z.ZodRawShape>>(
  component: ComponentArg<z.infer<S>>,
  options: McpComponentOptions<S>,
): McpComponentInstance<z.infer<S>> {
  type Props = z.infer<S>;
  const { name, description, schema, fallback = null, server, columns } = options;

  // Determine if this is table mode
  const isTableMode = component === null && columns != null;

  // Resolve lazy components
  let ResolvedComponent: ComponentType<Props> | null = null;
  if (component !== null && !isTableMode) {
    if (isLazyImport(component)) {
      ResolvedComponent = React.lazy(component as () => Promise<{ default: ComponentType<Props> }>);
    } else {
      ResolvedComponent = component as ComponentType<Props>;
    }
  }

  // The actual tool schema: if columns mode, wrap in { rows: z.array(schema) }
  // We need to import z dynamically to build the rows schema
  let toolSchema: z.ZodObject<z.ZodRawShape>;
  if (isTableMode) {
    // Use the z module from the schema to build rows wrapper
    const zod = require('zod') as typeof import('zod');
    toolSchema = zod.z.object({ rows: zod.z.array(schema) }) as unknown as z.ZodObject<z.ZodRawShape>;
  } else {
    toolSchema = schema;
  }

  const isLazy = component !== null && !isTableMode && isLazyImport(component);

  const McpWrappedComponent: McpComponentInstance<Props> = Object.assign(
    function McpWrappedComponentInner(directProps: Partial<Props>): ReactElement {
      const [lastData, setLastData] = useState<Props | null>(null);
      const [tableRows, setTableRows] = useState<Record<string, unknown>[] | null>(null);

      const execute = useCallback(
        async (args: unknown): Promise<CallToolResult> => {
          if (isTableMode) {
            const data = args as { rows: Record<string, unknown>[] };
            setTableRows(data.rows);
          } else {
            setLastData(args as Props);
          }
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, rendered: name }) }],
          };
        },
        [name],
      );

      useDynamicTool({
        name,
        description: description ?? name,
        schema: toolSchema,
        execute: execute as (args: z.infer<typeof toolSchema>) => Promise<CallToolResult>,
        server,
      });

      // Merge direct props with agent-provided data
      const hasDirectProps = Object.keys(directProps).length > 0;

      // Table mode rendering
      if (isTableMode && columns) {
        if (tableRows !== null) {
          return React.createElement(DefaultTable, { rows: tableRows, columns });
        }
        return React.createElement(React.Fragment, null, fallback);
      }

      // Component mode rendering
      const data = hasDirectProps ? ({ ...lastData, ...directProps } as Props) : lastData;

      if (data !== null && ResolvedComponent) {
        if (isLazy) {
          return React.createElement(
            Suspense,
            { fallback: fallback ?? null },
            React.createElement(ResolvedComponent, data),
          );
        }
        return React.createElement(ResolvedComponent, data);
      }

      // Direct props without agent data — render with what we have
      if (hasDirectProps && ResolvedComponent) {
        if (isLazy) {
          return React.createElement(
            Suspense,
            { fallback: fallback ?? null },
            React.createElement(ResolvedComponent, directProps as Props),
          );
        }
        return React.createElement(ResolvedComponent, directProps as Props);
      }

      return React.createElement(React.Fragment, null, fallback);
    },
    { toolName: name },
  );

  // Preserve display name for devtools
  McpWrappedComponent.displayName = `mcpComponent(${name})`;

  return McpWrappedComponent;
}
