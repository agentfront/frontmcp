/**
 * The v1 handler registration (`setRequestHandler(schema, handler)`) on top of v2's method-name registration.
 *
 * v1 took a zod request schema, read the method from its `method` literal, parsed the whole request with it and
 * passed the handler a v1 `extra`. v2 takes a method name, validates spec methods against its own wire schemas and
 * passes a context (`ctx.mcpReq`, `ctx.http`). FrontMCP registers custom methods (skills, events) and replaces
 * `initialize`, so every v1-style handler is registered with v2's schema form and a pass-through params schema:
 * the handler sees the request as the client sent it, parsed by FrontMCP's own schema, as on v1.
 */
import type { BaseContext, StandardSchemaV1 } from '@modelcontextprotocol/server';

import { ErrorCode, McpError, toV1RequestError } from './compat-errors';
import type { MessageExtraInfo, RequestHandlerExtra, RequestInfo } from './compat-types';

/** The zod object shape FrontMCP's request and notification schemas have. */
export interface MethodSchema {
  shape?: Record<string, unknown>;
  parse(value: unknown): unknown;
}

export type V1RequestHandler = (request: never, extra: RequestHandlerExtra) => unknown;
export type V1NotificationHandler = (notification: never) => unknown;

/** Accepts any params object as it is: FrontMCP's own schema parses the request afterwards. */
export const PASS_THROUGH_PARAMS: StandardSchemaV1<Record<string, unknown>> = {
  '~standard': {
    version: 1,
    vendor: 'frontmcp',
    validate: (value) => ({ value: value as Record<string, unknown> }),
  },
};

/** Whether the second argument of `setRequestHandler` is a v1 zod request schema rather than a v2 method name. */
export function isMethodSchema(value: unknown): value is MethodSchema {
  return typeof value === 'object' && value !== null && typeof (value as MethodSchema).parse === 'function';
}

/** The JSON-RPC method a v1 request or notification schema is bound to, read from its `method` literal. */
export function methodOfSchema(schema: MethodSchema): string {
  const method = schema.shape?.['method'] as { value?: unknown; _def?: { values?: unknown[] } } | undefined;
  if (typeof method?.value === 'string') return method.value;
  const values = method?._def?.values;
  if (Array.isArray(values) && typeof values[0] === 'string') return values[0];
  throw new Error('Schema is missing a method literal');
}

const TRANSPORT_INFO = Symbol('frontmcp.transportInfo');

/** Keep what the transport passed with the message on the v2 context, for {@link toV1Extra}. */
export function withTransportInfo<C extends object>(ctx: C, transportInfo: object | undefined): C {
  if (transportInfo) Object.defineProperty(ctx, TRANSPORT_INFO, { value: transportInfo, enumerable: false });
  return ctx;
}

function requestInfoOf(info: MessageExtraInfo | undefined): RequestInfo | undefined {
  if (info?.requestInfo) return info.requestInfo;
  const request = info?.request;
  if (!request) return undefined;
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => (headers[key] = value));
  return { headers, url: new URL(request.url) };
}

/** The v1 `extra` of a handler, built from the v2 context. */
export function toV1Extra(ctx: BaseContext): RequestHandlerExtra {
  const info = (ctx as BaseContext & { [TRANSPORT_INFO]?: MessageExtraInfo })[TRANSPORT_INFO];
  const { signal } = ctx.mcpReq;
  return {
    signal,
    sessionId: ctx.sessionId,
    _meta: ctx.mcpReq._meta,
    authInfo: info?.authInfo ?? ctx.http?.authInfo,
    requestId: ctx.mcpReq.id,
    requestInfo: requestInfoOf(info),
    closeSSEStream: info?.closeSSEStream,
    closeStandaloneSSEStream: info?.closeStandaloneSSEStream,
    sendNotification: async (notification) => {
      if (signal.aborted) return;
      await ctx.mcpReq.notify(notification);
    },
    sendRequest: async (request, resultSchema, options) => {
      if (signal.aborted) throw new McpError(ErrorCode.ConnectionClosed, 'Request was cancelled');
      return ctx.mcpReq.send(request, resultSchema, options).catch((error: unknown) => {
        throw toV1RequestError(error);
      });
    },
  };
}

/** The v2 handler (params, ctx) that runs a v1 handler (request, extra). */
export function adaptRequestHandler(
  schema: MethodSchema,
  method: string,
  handler: V1RequestHandler,
): (params: Record<string, unknown>, ctx: BaseContext) => Promise<never> {
  return async (params, ctx) => {
    const request = schema.parse({ method, params });
    return (await handler(request as never, toV1Extra(ctx))) as never;
  };
}

/** The v2 notification handler (params, notification) that runs a v1 handler (notification). */
export function adaptNotificationHandler(
  schema: MethodSchema,
  handler: V1NotificationHandler,
): (params: Record<string, unknown>, notification: unknown) => Promise<void> {
  return async (_params, notification) => {
    await handler(schema.parse(notification) as never);
  };
}
