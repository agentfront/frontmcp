/**
 * useApiClient — registers OpenAPI operations as MCP tools.
 *
 * Each operation becomes a dynamic tool that makes an HTTP request
 * using an injected HttpClient, a custom fetch, or globalThis.fetch.
 */

import { useContext, useEffect, useRef } from 'react';
import type { CallToolResult } from '@frontmcp/sdk';
import { FrontMcpContext } from '../provider/FrontMcpContext';
import type { ApiClientOptions, HttpClient, HttpRequestConfig, HttpResponse } from './api.types';
import { createFetchClient } from './createFetchClient';

function interpolatePath(path: string, params: Record<string, unknown>): string {
  return path.replace(/\{(\w+)\}/g, (_, key) => {
    const value = params[key];
    return value != null ? String(value) : `{${key}}`;
  });
}

export function useApiClient(options: ApiClientOptions): void {
  const { baseUrl, operations, headers, prefix = 'api', client, fetch: customFetch, server } = options;
  const { dynamicRegistry } = useContext(FrontMcpContext);

  const headersRef = useRef(headers);
  headersRef.current = headers;

  // Keep the client ref fresh so token-refresh / header changes are captured
  const clientRef = useRef<HttpClient>(client ?? createFetchClient(customFetch));
  clientRef.current = client ?? createFetchClient(customFetch);

  useEffect(() => {
    const cleanups: (() => void)[] = [];

    for (const op of operations) {
      const toolName = `${prefix}_${op.operationId}`;

      const execute = async (args: Record<string, unknown>): Promise<CallToolResult> => {
        const resolvedHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(typeof headersRef.current === 'function' ? headersRef.current() : (headersRef.current ?? {})),
        };

        const url = baseUrl + interpolatePath(op.path, args);
        const body = args['body'];
        const method = op.method;

        const requestConfig: HttpRequestConfig = {
          method,
          url,
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

      cleanups.push(
        dynamicRegistry.registerTool({
          name: toolName,
          description: op.description,
          inputSchema: op.inputSchema,
          execute,
        }),
      );
    }

    return () => cleanups.forEach((fn) => fn());
  }, [dynamicRegistry, baseUrl, operations, prefix, client, customFetch]);
}
