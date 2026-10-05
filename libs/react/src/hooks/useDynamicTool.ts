/**
 * useDynamicTool — registers an MCP tool on mount, unregisters on unmount.
 *
 * Uses useRef for the execute function to avoid stale closures.
 * The provider registers the tool with the server as a real tool, so it
 * runs through the server's flows (hooks, authorities, `availableWhen`),
 * appears in useListTools and can be called by agents, WebMCP included.
 *
 * Supports both JSON Schema and zod-based schemas. When a zod schema
 * is provided, input is validated before reaching the execute callback.
 */

import { useContext, useEffect, useMemo, useRef } from 'react';

import type { z } from '@frontmcp/lazy-zod';
import type { CallToolResult } from '@frontmcp/sdk';

import { FrontMcpContext } from '../provider/FrontMcpContext';
import type { DynamicToolDef } from '../types';
import { useIsomorphicLayoutEffect } from '../utils/useIsomorphicLayoutEffect';
import { zodToJsonSchema } from '../utils/zodToJsonSchema';

/** Options every dynamic tool takes, whichever way its schema is given. */
interface UseDynamicToolCommonOptions {
  /** MCP behavioral hints, e.g. `{ readOnlyHint: true }`. */
  annotations?: DynamicToolDef['annotations'];
  /** Where the tool is offered, e.g. `{ surface: ['webmcp'] }` for in-browser agents only. */
  availableWhen?: DynamicToolDef['availableWhen'];
  /**
   * Id of the server app the tool joins. Needed only for a server with more than one local app;
   * defaults to the provider's `dynamicToolApps` entry for the server.
   */
  app?: string;
}

// ─── Zod-based options ───────────────────────────────────────────────────────

export interface UseDynamicToolSchemaOptions<S extends z.ZodObject<z.ZodRawShape>> extends UseDynamicToolCommonOptions {
  name: string;
  description: string;
  /** Zod schema for type-safe input validation. */
  schema: S;
  inputSchema?: never;
  /** Type-safe execute callback — args are validated against `schema`. */
  execute: (args: z.infer<S>) => Promise<CallToolResult>;
  /** Set to false to conditionally disable the tool (default: true). */
  enabled?: boolean;
  /** Target a specific named server from the ServerRegistry. */
  server?: string;
}

// ─── JSON Schema options (backward compat) ───────────────────────────────────

export interface UseDynamicToolJsonSchemaOptions extends UseDynamicToolCommonOptions {
  name: string;
  description: string;
  schema?: never;
  /** Raw JSON Schema for the tool's input. */
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<CallToolResult>;
  /** Set to false to conditionally disable the tool (default: true). */
  enabled?: boolean;
  /** Target a specific named server from the ServerRegistry. */
  server?: string;
}

export type UseDynamicToolOptions<S extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>> =
  | UseDynamicToolSchemaOptions<S>
  | UseDynamicToolJsonSchemaOptions;

function stableKey(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(Math.random());
  }
}

export function useDynamicTool<S extends z.ZodObject<z.ZodRawShape>>(options: UseDynamicToolOptions<S>): void {
  const { name, description, app, execute, enabled = true } = options;
  const schema = 'schema' in options && options.schema ? options.schema : null;
  const { getDynamicRegistry } = useContext(FrontMcpContext);
  const dynamicRegistry = getDynamicRegistry(options.server);

  // Resolve JSON Schema from zod or pass through raw inputSchema. An inline
  // `z.object(...)` or object literal is a new value on every render, so the schema is
  // keyed by content: re-registering the tool on each render would notify the registry,
  // re-render the component and never settle.
  const computedInputSchema = schema
    ? zodToJsonSchema(schema)
    : (options as UseDynamicToolJsonSchemaOptions).inputSchema;
  const inputSchemaKey = stableKey(computedInputSchema);
  // Memoized on the content key on purpose, see above
  const resolvedInputSchema = useMemo(() => computedInputSchema, [inputSchemaKey]);
  // Same for inline annotations / availability objects
  const annotationsKey = stableKey(options.annotations ?? null);
  const annotations = useMemo(() => options.annotations, [annotationsKey]);
  const availableWhenKey = stableKey(options.availableWhen ?? null);
  const availableWhen = useMemo(() => options.availableWhen, [availableWhenKey]);

  const executeRef = useRef(execute);
  const schemaRef = useRef(schema);

  // Set at commit, before passive effects and never during render: a render React discards must not reach a running tool
  useIsomorphicLayoutEffect(() => {
    executeRef.current = execute;
    schemaRef.current = schema;
  }, [execute, schema]);

  useEffect(() => {
    if (!enabled) return;

    const stableExecute = async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const zodSchema = schemaRef.current;
      if (zodSchema) {
        const result = zodSchema.safeParse(args);
        if (!result.success) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'validation_error',
                  issues: result.error.issues.map((i) => ({
                    path: i.path,
                    message: i.message,
                  })),
                }),
              },
            ],
          };
        }
        return (executeRef.current as (args: z.infer<typeof zodSchema>) => Promise<CallToolResult>)(result.data);
      }
      return (executeRef.current as (args: Record<string, unknown>) => Promise<CallToolResult>)(args);
    };

    const unregister = dynamicRegistry.registerTool({
      name,
      description,
      inputSchema: resolvedInputSchema,
      execute: stableExecute,
      ...(annotations && { annotations }),
      ...(availableWhen && { availableWhen }),
      ...(app && { app }),
    });

    return unregister;
  }, [dynamicRegistry, name, description, resolvedInputSchema, annotations, availableWhen, app, enabled]);
}
