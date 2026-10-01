/**
 * useApiClient — registers OpenAPI operations as MCP tools.
 *
 * Each operation becomes a dynamic tool that makes an HTTP request
 * using an injected HttpClient, a custom fetch, or globalThis.fetch.
 *
 * Options may be written inline: the tools are registered again only when the
 * `prefix`, the target server, or what an operation declares (its id, description,
 * method, path, input schema or parameters) changes. `baseUrl`, `headers`,
 * `client` and `fetch` are read when a tool runs.
 */

import { useContext, useEffect, useRef } from 'react';

import type { CallToolResult } from '@frontmcp/sdk';

import { FrontMcpContext } from '../provider/FrontMcpContext';
import type { ApiClientOptions, ApiOperation, HttpClient, HttpRequestConfig } from './api.types';
import { createFetchClient } from './createFetchClient';

function interpolatePath(path: string, params: Record<string, unknown>): string {
  return path.replace(/\{(\w+)\}/g, (_, key) => {
    const value = params[key];
    return value != null ? encodeURIComponent(String(value)) : `{${key}}`;
  });
}

/** A query or header value as text: objects as JSON, everything else with `String()`. */
function paramText(value: unknown): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

/**
 * The request URL: the base URL, the path with its `{param}` placeholders filled, and the arguments
 * the operation declares `in: 'query'` as the query string (an array repeats its key).
 */
function buildRequestUrl(baseUrl: string, op: ApiOperation, args: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const param of op.parameters ?? []) {
    if (param.in !== 'query') continue;
    const value = args[param.name];
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(param.name, paramText(item));
  }
  const url = baseUrl + interpolatePath(op.path, args);
  const search = query.toString();
  return search ? `${url}${url.includes('?') ? '&' : '?'}${search}` : url;
}

/** The arguments the operation declares `in: 'header'`, as request headers. */
function headerParams(op: ApiOperation, args: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const param of op.parameters ?? []) {
    if (param.in !== 'header') continue;
    const value = args[param.name];
    if (value !== undefined && value !== null) headers[param.name] = paramText(value);
  }
  return headers;
}

/** What a tool's registration depends on; a change registers the operations again. */
function registrationKey(operations: ApiOperation[]): string {
  return JSON.stringify(
    operations.map((op) => [op.operationId, op.description, op.method, op.path, op.inputSchema, op.parameters ?? null]),
  );
}

export function useApiClient(options: ApiClientOptions): void {
  const { operations, prefix = 'api', client, fetch: customFetch } = options;
  const { getDynamicRegistry } = useContext(FrontMcpContext);
  const dynamicRegistry = getDynamicRegistry(options.server);

  const baseUrlRef = useRef(options.baseUrl);
  baseUrlRef.current = options.baseUrl;
  const headersRef = useRef(options.headers);
  headersRef.current = options.headers;
  const operationsRef = useRef(operations);
  operationsRef.current = operations;

  // Keep the client ref fresh so token-refresh / header changes are captured
  const clientRef = useRef<HttpClient>(client ?? createFetchClient(customFetch));
  clientRef.current = client ?? createFetchClient(customFetch);

  const key = registrationKey(operations);

  useEffect(() => {
    const cleanups = operationsRef.current.map((registered) => {
      const execute = async (args: Record<string, unknown>): Promise<CallToolResult> => {
        const op = operationsRef.current.find((o) => o.operationId === registered.operationId) ?? registered;
        const resolvedHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(typeof headersRef.current === 'function' ? headersRef.current() : (headersRef.current ?? {})),
          ...headerParams(op, args),
        };

        const body = args['body'];
        const method = op.method;

        const requestConfig: HttpRequestConfig = {
          method,
          url: buildRequestUrl(baseUrlRef.current, op, args),
          headers: resolvedHeaders,
        };

        if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
          requestConfig.body = body;
        }

        const response = await clientRef.current.request(requestConfig);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: response.status,
                statusText: response.statusText,
                data: response.data,
              }),
            },
          ],
          isError: response.status >= 400,
        };
      };

      return dynamicRegistry.registerTool({
        name: `${prefix}_${registered.operationId}`,
        description: registered.description,
        inputSchema: registered.inputSchema,
        execute,
      });
    });

    return () => {
      cleanups.forEach((fn) => {
        fn();
      });
    };
  }, [dynamicRegistry, prefix, key]);
}
