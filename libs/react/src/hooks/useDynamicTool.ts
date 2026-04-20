/**
 * useDynamicTool — registers an MCP tool on mount, unregisters on unmount.
 *
 * Uses useRef for the execute function to avoid stale closures.
 * The tool appears in useListTools and can be called by agents.
 *
 * Supports both JSON Schema and zod-based schemas. When a zod schema
 * is provided, input is validated before reaching the execute callback.
 */

import { useContext, useEffect, useMemo, useRef } from 'react';

import type { z } from '@frontmcp/lazy-zod';
import type { CallToolResult } from '@frontmcp/sdk';

import { FrontMcpContext } from '../provider/FrontMcpContext';
import { zodToJsonSchema } from '../utils/zodToJsonSchema';

// ─── Zod-based options ───────────────────────────────────────────────────────

export interface UseDynamicToolSchemaOptions<S extends z.ZodObject<z.ZodRawShape>> {
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

export interface UseDynamicToolJsonSchemaOptions {
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

export function useDynamicTool<S extends z.ZodObject<z.ZodRawShape>>(options: UseDynamicToolOptions<S>): void {
  const { name, description, enabled = true } = options;
  const { getDynamicRegistry } = useContext(FrontMcpContext);
  const dynamicRegistry = getDynamicRegistry(options.server);

  // Resolve JSON Schema from zod or pass through raw inputSchema
  const resolvedInputSchema = useMemo(() => {
    if ('schema' in options && options.schema) {
      return zodToJsonSchema(options.schema);
    }
    return (options as UseDynamicToolJsonSchemaOptions).inputSchema;
  }, ['schema' in options ? options.schema : undefined, 'inputSchema' in options ? options.inputSchema : undefined]);

  // Keep the latest execute fn in a ref to avoid stale closures
  const executeRef = useRef(options.execute);
  executeRef.current = options.execute;

  // Keep schema ref for validation
  const schemaRef = useRef('schema' in options && options.schema ? options.schema : null);
  schemaRef.current = 'schema' in options && options.schema ? options.schema : null;

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
    });

    return unregister;
  }, [dynamicRegistry, name, description, resolvedInputSchema, enabled]);
}
