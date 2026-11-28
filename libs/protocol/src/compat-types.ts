/**
 * Types of the MCP SDK v1 that v2 renamed or reshaped, kept for `@frontmcp/sdk`.
 */
import {
  JSONRPCErrorResponseSchema,
  CallToolResultSchema as V2CallToolResultSchema,
  ToolSchema as V2ToolSchema,
} from '@modelcontextprotocol/core';
import type {
  AuthInfo,
  JSONRPCErrorResponse,
  Notification,
  Request,
  RequestId,
  RequestMeta,
  RequestOptions,
  StandardSchemaV1,
  CallToolResult as V2CallToolResult,
  MessageExtraInfo as V2MessageExtraInfo,
} from '@modelcontextprotocol/server';

import { internalZ as z } from '@frontmcp/lazy-zod';

/** v1 name of {@link JSONRPCErrorResponse}. */
export type JSONRPCError = JSONRPCErrorResponse;
/** v1 name of `JSONRPCErrorResponseSchema`. */
export const JSONRPCErrorSchema = JSONRPCErrorResponseSchema;

/**
 * A `tools/call` result whose `structuredContent` is an object, as on v1. v2 types it `unknown`, since the 2026-07-28
 * revision allows any JSON value there; FrontMCP's tools return objects, and code that reads results expects one.
 */
export type CallToolResult = V2CallToolResult & { structuredContent?: Record<string, unknown> };
/** v2's `CallToolResultSchema` with v1's object `structuredContent`, so the schema and {@link CallToolResult} agree. */
export const CallToolResultSchema = V2CallToolResultSchema.extend({
  structuredContent: z.record(z.string(), z.unknown()).optional(),
});

/**
 * v2's `ToolSchema`, but an input schema's `properties` must be schemas (objects), as on v1: v2 accepts any JSON value
 * there, so a tool whose properties are not schemas (`{ name: 'string' }`) would pass `DirectMcpServer.registerTool()`.
 */
export const ToolSchema = V2ToolSchema.extend({
  inputSchema: V2ToolSchema.shape.inputSchema.extend({
    properties: z
      .record(
        z.string(),
        z.custom<object>((value) => value !== null && (typeof value === 'object' || typeof value === 'function')),
      )
      .optional(),
  }),
});

/** Headers and URL of the HTTP request a message came in on (v1 `RequestInfo`). */
export interface RequestInfo {
  headers: Record<string, string | string[] | undefined>;
  url?: URL;
}

/** What a transport passes with each message: v2's fields plus v1's `requestInfo`, which FrontMCP's transports set. */
export interface MessageExtraInfo extends V2MessageExtraInfo {
  requestInfo?: RequestInfo;
}

/**
 * The second argument of a request handler, as v1 shaped it. v2 passes a context (`ctx.mcpReq`, `ctx.http`)
 * instead; `@frontmcp/protocol`'s `McpServer` and `Client` build this object from it.
 */
export type RequestHandlerExtra<
  SendRequestT extends Request = Request,
  SendNotificationT extends Notification = Notification,
> = {
  signal: AbortSignal;
  authInfo?: AuthInfo;
  sessionId?: string;
  _meta?: RequestMeta;
  requestId: RequestId;
  requestInfo?: RequestInfo;
  /** v1's task fields; FrontMCP runs tasks itself, so they stay unset. */
  taskId?: string;
  taskRequestedTtl?: number;
  sendNotification: (notification: SendNotificationT) => Promise<void>;
  sendRequest: <U extends StandardSchemaV1>(
    request: SendRequestT,
    resultSchema: U,
    options?: RequestOptions,
  ) => Promise<StandardSchemaV1.InferOutput<U>>;
  closeSSEStream?: () => void;
  closeStandaloneSSEStream?: () => void;
};
