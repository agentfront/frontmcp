/**
 * useApiClient — registers OpenAPI operations as MCP tools.
 *
 * Each operation becomes a dynamic tool that makes an HTTP request
 * using an injected HttpClient, a custom fetch, or globalThis.fetch.
 *
 * Options may be written inline: the tools are registered again only when the
 * `prefix`, the target server, or what an operation declares (its id, description,
 * method, path, input schema or parameters) changes. `baseUrl`, `headers`,
 * `client` and `fetch` are read when a tool runs, from the latest committed render.
 */

import { useContext, useEffect, useRef } from 'react';

import type { CallToolResult } from '@frontmcp/sdk';

import { FrontMcpContext } from '../provider/FrontMcpContext';
import { useIsomorphicLayoutEffect } from '../utils/useIsomorphicLayoutEffect';
import type {
  ApiClientOptions,
  ApiOperation,
  ApiParameter,
  ApiParameterStyle,
  HttpClient,
  HttpRequestConfig,
} from './api.types';
import { createFetchClient } from './createFetchClient';

function interpolatePath(path: string, params: Record<string, unknown>): string {
  return path.replace(/\{(\w+)\}/g, (_, key) => {
    const value = params[key];
    return value != null ? encodeURIComponent(String(value)) : `{${key}}`;
  });
}

/** A single value as text: objects as JSON, everything else with `String()`. */
function paramText(value: unknown): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const QUERY_DELIMITERS: Partial<Record<ApiParameterStyle, string>> = { spaceDelimited: '%20', pipeDelimited: '%7C' };

/** An object's entries become `key=value` items when exploded, else separate `key` and `value` items. */
function serializedItems(
  value: unknown[] | Record<string, unknown>,
  explode: boolean,
  encode: (text: string) => string,
): string[] {
  if (Array.isArray(value)) return value.map((item) => encode(paramText(item)));
  return Object.entries(value).flatMap(([key, item]) =>
    explode ? [`${encode(key)}=${encode(paramText(item))}`] : [encode(key), encode(paramText(item))],
  );
}

/** One query argument as `name=value` pairs, laid out by its OpenAPI `style` and `explode`. */
function queryPairs(param: ApiParameter, value: unknown): string[] {
  const style = param.style ?? 'form';
  const explode = param.explode ?? style === 'form';
  const name = encodeURIComponent(param.name);
  if (style === 'deepObject' && isRecord(value)) {
    return Object.entries(value).map(
      ([key, item]) => `${encodeURIComponent(`${param.name}[${key}]`)}=${encodeURIComponent(paramText(item))}`,
    );
  }
  if (!Array.isArray(value) && !isRecord(value)) return [`${name}=${encodeURIComponent(paramText(value))}`];
  const items = serializedItems(value, explode, encodeURIComponent);
  if (!explode) return [`${name}=${items.join(QUERY_DELIMITERS[style] ?? ',')}`];
  return Array.isArray(value) ? items.map((item) => `${name}=${item}`) : items;
}

/**
 * The request URL: the base URL, the path with its `{param}` placeholders filled, and the arguments
 * the operation declares `in: 'query'` as the query string.
 */
function buildRequestUrl(baseUrl: string, op: ApiOperation, args: Record<string, unknown>): string {
  const pairs: string[] = [];
  for (const param of op.parameters ?? []) {
    if (param.in !== 'query') continue;
    const value = args[param.name];
    if (value === undefined || value === null) continue;
    pairs.push(...queryPairs(param, value));
  }
  const url = baseUrl + interpolatePath(op.path, args);
  return pairs.length > 0 ? `${url}${url.includes('?') ? '&' : '?'}${pairs.join('&')}` : url;
}

/** A header argument in the OpenAPI `simple` style: an array's or object's items joined with commas. */
function headerText(param: ApiParameter, value: unknown): string {
  if (!Array.isArray(value) && !isRecord(value)) return paramText(value);
  return serializedItems(value, param.explode ?? false, (text) => text).join(',');
}

/** The arguments the operation declares `in: 'header'`, as request headers. */
function headerParams(op: ApiOperation, args: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const param of op.parameters ?? []) {
    if (param.in !== 'header') continue;
    const value = args[param.name];
    if (value !== undefined && value !== null) headers[param.name] = headerText(param, value);
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
  const { baseUrl, operations, headers, prefix = 'api', client, fetch: customFetch } = options;
  const { getDynamicRegistry } = useContext(FrontMcpContext);
  const dynamicRegistry = getDynamicRegistry(options.server);

  const baseUrlRef = useRef(baseUrl);
  const headersRef = useRef(headers);
  const operationsRef = useRef(operations);
  const clientRef = useRef<HttpClient>(client ?? createFetchClient(customFetch));

  // Set at commit, before passive effects and never during render: a render React discards must not reach a running tool
  useIsomorphicLayoutEffect(() => {
    baseUrlRef.current = baseUrl;
    headersRef.current = headers;
    operationsRef.current = operations;
    clientRef.current = client ?? createFetchClient(customFetch);
  }, [baseUrl, headers, operations, client, customFetch]);

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
