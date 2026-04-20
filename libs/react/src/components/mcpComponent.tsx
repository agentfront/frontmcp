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

import React, { Suspense, useCallback, useState, type ComponentType, type ReactElement, type ReactNode } from 'react';

import { z } from '@frontmcp/lazy-zod';
import type { CallToolResult } from '@frontmcp/sdk';

import { useDynamicTool } from '../hooks/useDynamicTool';
import type { McpColumnDef } from '../types';

// ─── Lazy branding ──────────────────────────────────────────────────────────

const MCP_LAZY_MARKER = Symbol.for('frontmcp:lazy');

/** Brand applied by mcpLazy to distinguish lazy imports from zero-arg components. */
type McpLazyBrand = { readonly __mcpLazy: true };

/** A branded lazy factory returned by mcpLazy(). */
export type LazyFactory<Props> = (() => Promise<{ default: ComponentType<Props> }>) & McpLazyBrand;

/**
 * Brand a factory function as a lazy import so mcpComponent can
 * distinguish `() => import(...)` from zero-arg function components.
 */
export function mcpLazy<Props>(factory: () => Promise<{ default: ComponentType<Props> }>): LazyFactory<Props> {
  return Object.assign(factory, { [MCP_LAZY_MARKER]: true }) as unknown as LazyFactory<Props>;
}

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

type ComponentArg<Props> = ComponentType<Props> | ((props: Props) => ReactElement) | LazyFactory<Props> | null;

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

function isLazyImport<Props>(fn: ComponentArg<Props>): fn is LazyFactory<Props> {
  if (typeof fn !== 'function') return false;
  // Only treat functions branded with mcpLazy as lazy imports
  return MCP_LAZY_MARKER in fn;
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
  let toolSchema: z.ZodObject<z.ZodRawShape>;
  if (isTableMode) {
    toolSchema = z.object({ rows: z.array(schema) }) as unknown as z.ZodObject<z.ZodRawShape>;
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
