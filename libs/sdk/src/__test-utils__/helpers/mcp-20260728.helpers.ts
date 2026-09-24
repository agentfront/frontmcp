/// <reference types="jest" />
/**
 * In-process MCP 2026-07-28 client for SDK specs.
 *
 * Builds a real scope from a `@FrontMcp()`-shaped config and drives it through
 * the Web-standard fetch handler with 2026-07-28 JSON-RPC requests, so a spec
 * exercises the same flows a Worker or an HTTP client would, without a port.
 */
import 'reflect-metadata';

import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { MCP_20260728_META, PROTOCOL_2026_07_28 } from '@frontmcp/protocol';

import { LogLevel, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { createWebFetchHandler, type WebFetchHandler } from '../../transport/web-fetch-handler';

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: JsonRpcError;
}

export interface Rpc20260728Options {
  headers?: Record<string, string>;
  capabilities?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface Rpc20260728Response {
  status: number;
  headers: Headers;
  message: JsonRpcMessage;
  notifications: JsonRpcMessage[];
}

export interface TestFetchServer {
  handler: WebFetchHandler;
  instance: FrontMcpInstance;
}

export const TEST_CLIENT_INFO = { name: 'spec-client', version: '1.0.0' };

export async function createTestFetchServer(config: FrontMcpConfigInput): Promise<TestFetchServer> {
  const instance = await FrontMcpInstance.createForGraph({ logging: { level: LogLevel.Off }, ...config });
  const scope = instance.getScopes()[0] as Scope | undefined;
  if (!scope) {
    throw new Error('createTestFetchServer: the config produced no scope');
  }
  return { handler: createWebFetchHandler(scope), instance };
}

let nextRequestId = 1;

export async function rpc20260728(
  handler: WebFetchHandler,
  method: string,
  params: Record<string, unknown> = {},
  options: Rpc20260728Options = {},
): Promise<Rpc20260728Response> {
  const id = nextRequestId++;
  const target = method === 'resources/read' ? params['uri'] : params['name'];
  const body: JsonRpcMessage = {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      ...params,
      _meta: {
        [MCP_20260728_META.protocolVersion]: PROTOCOL_2026_07_28,
        [MCP_20260728_META.clientInfo]: TEST_CLIENT_INFO,
        [MCP_20260728_META.clientCapabilities]: options.capabilities ?? {},
        ...options.meta,
      },
    },
  };
  const response = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL_2026_07_28,
        'mcp-method': method,
        ...(typeof target === 'string' ? { 'mcp-name': target } : {}),
        ...options.headers,
      },
    }),
  );
  const messages = parseMessages(await response.text(), response.headers.get('content-type') ?? '');
  const message = messages.find((candidate) => candidate.id === id) ?? messages[0];
  if (!message) {
    throw new Error(`rpc20260728: ${method} returned HTTP ${response.status} with no JSON-RPC message`);
  }
  return {
    status: response.status,
    headers: response.headers,
    message,
    notifications: messages.filter((candidate) => candidate.id !== id),
  };
}

function parseMessages(text: string, contentType: string): JsonRpcMessage[] {
  if (!text) return [];
  if (!contentType.includes('text/event-stream')) {
    return [JSON.parse(text) as JsonRpcMessage];
  }
  return text
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
        .join(''),
    )
    .filter((data) => data.length > 0)
    .map((data) => JSON.parse(data) as JsonRpcMessage);
}

export interface TestJwtIssuer {
  issuer: string;
  jwks: { keys: JWK[] };
  sign(claims: Record<string, unknown>, subject: string): Promise<string>;
}

export async function createTestJwtIssuer(issuer = 'https://auth.example.com'): Promise<TestJwtIssuer> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'spec-key', alg: 'RS256', use: 'sig' };
  return {
    issuer,
    jwks: { keys: [jwk] },
    sign: (claims, subject) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'spec-key' })
        .setIssuer(issuer)
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(privateKey),
  };
}
