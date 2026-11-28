/**
 * The MCP `Server` FrontMCP builds on: v2's `Server`, with v1's handler registration and `tools/call` checks.
 *
 * - `setRequestHandler(schema, handler)` and `setNotificationHandler(schema, handler)` take a v1 zod schema, as
 *   FrontMCP's handlers are written (see `compat-handlers.ts`). A method name (the v2 form) still works.
 * - FrontMCP answers `initialize` itself. v2's own handler records the negotiated version, which picks the wire era,
 *   and the client's capabilities; this server records both from FrontMCP's answer, so `getClientCapabilities()` and
 *   the era checks work as they would on v2's handler.
 * - `tools/call` keeps v1's checks: the request against `CallToolRequestSchema`, and the result against
 *   `CreateTaskResultSchema` for a task-augmented call and `CallToolResultSchema` otherwise. v2 checks every result
 *   as a `CallToolResult`, which would turn FrontMCP's task results into empty tool results.
 * - A missing resource answers `-32002` on 2025-era sessions, as on v1 and in the 2025-11-25 spec. v2 rewrites a
 *   handler's `-32002` to `-32602` on every revision (the 2026-07-28 code); this server puts `-32002` back on the
 *   error responses of requests whose handler threw it, unless the session speaks 2026-07-28.
 */
import { CallToolRequestSchema, CreateTaskResultSchema } from '@modelcontextprotocol/core';
import {
  isJSONRPCErrorResponse,
  ProtocolErrorCode,
  Server as V2Server,
  type BaseContext,
  type ClientCapabilities,
  type Implementation,
  type InitializeResult,
  type JSONRPCMessage,
  type JSONRPCRequest,
  type RequestId,
  type Result,
  type ServerContext,
  type ServerOptions,
  type Transport,
  type MessageExtraInfo as V2MessageExtraInfo,
} from '@modelcontextprotocol/server';

import { ErrorCode, McpError, toV1RequestError } from './compat-errors';
import {
  adaptNotificationHandler,
  adaptRequestHandler,
  isMethodSchema,
  methodOfSchema,
  PASS_THROUGH_PARAMS,
  withTransportInfo,
  type MethodSchema,
  type V1NotificationHandler,
  type V1RequestHandler,
} from './compat-handlers';
import { CallToolResultSchema } from './compat-types';

export type { ServerOptions };

/** The v2 server state its own `initialize` handler sets, which FrontMCP's handler replaces. */
interface InitializeState {
  _negotiatedProtocolVersion?: string;
  _clientCapabilities?: ClientCapabilities;
  _clientVersion?: Implementation;
}

type V2SetRequestHandler = (method: string, ...rest: unknown[]) => void;
type V2SetNotificationHandler = (method: string, ...rest: unknown[]) => void;

/** The first revision of the 2026-07-28 era, whose missing-resource code is `-32602`. */
const FIRST_MODERN_PROTOCOL_VERSION = '2026-07-28';
/** A transport's own `send`, kept the first time a server wraps it. */
const ORIGINAL_SEND = Symbol('frontmcp.originalSend');
type WrappableTransport = Transport & { [ORIGINAL_SEND]?: Transport['send'] };

function codeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class Server extends V2Server {
  /** Requests whose handler threw `-32002`, until their error response is sent. */
  private readonly resourceNotFoundIds = new Set<RequestId>();

  constructor(serverInfo: Implementation, options?: ServerOptions) {
    super(serverInfo, options);
    // A request this server sends fails on a timeout or a closed connection as on v1 (see `toV1RequestError`)
    const request = this.request.bind(this) as (...args: unknown[]) => Promise<unknown>;
    this.request = ((...args: unknown[]) =>
      request(...args).catch((error: unknown) => {
        throw toV1RequestError(error);
      })) as V2Server['request'];
  }

  override async connect(transport: Transport): Promise<void> {
    this.restoreResourceNotFoundCode(transport);
    await super.connect(transport);
  }

  protected override _onclose(): void {
    this.resourceNotFoundIds.clear();
    super._onclose();
  }

  protected override buildContext(ctx: BaseContext, transportInfo?: V2MessageExtraInfo): ServerContext {
    return withTransportInfo(super.buildContext(ctx, transportInfo), transportInfo);
  }

  // v1: (requestSchema, handler). v2: (method, handler) or (method, schemas, handler).
  override setRequestHandler(...args: unknown[]): void {
    const [first, second, third] = args;
    const v2SetRequestHandler = super.setRequestHandler.bind(this) as V2SetRequestHandler;
    if (!isMethodSchema(first)) {
      v2SetRequestHandler(first as string, second, third);
      return;
    }
    const method = methodOfSchema(first);
    let handler = adaptRequestHandler(first, method, second as V1RequestHandler);
    if (method === 'initialize') handler = this.recordingInitialize(handler);
    v2SetRequestHandler(method, { params: PASS_THROUGH_PARAMS }, handler);
  }

  // v1: (notificationSchema, handler). v2: (method, handler) or (method, schemas, handler).
  override setNotificationHandler(...args: unknown[]): void {
    const [first, second, third] = args;
    const v2SetNotificationHandler = super.setNotificationHandler.bind(this) as V2SetNotificationHandler;
    if (!isMethodSchema(first)) {
      v2SetNotificationHandler(first as string, second, third);
      return;
    }
    const schema: MethodSchema = first;
    v2SetNotificationHandler(
      methodOfSchema(schema),
      { params: PASS_THROUGH_PARAMS },
      adaptNotificationHandler(schema, second as V1NotificationHandler),
    );
  }

  protected override _wrapHandler(
    method: string,
    handler: (request: JSONRPCRequest, ctx: ServerContext) => Promise<Result>,
  ): (request: JSONRPCRequest, ctx: ServerContext) => Promise<Result> {
    const wrapped = method === 'tools/call' ? this.v1ToolsCall(handler) : super._wrapHandler(method, handler);
    return async (request, ctx) => {
      try {
        return await wrapped(request, ctx);
      } catch (error) {
        if (codeOf(error) === ProtocolErrorCode.ResourceNotFound) this.resourceNotFoundIds.add(request.id);
        throw error;
      }
    };
  }

  /** v1's `tools/call` checks (see the module comment). */
  private v1ToolsCall(
    handler: (request: JSONRPCRequest, ctx: ServerContext) => Promise<Result>,
  ): (request: JSONRPCRequest, ctx: ServerContext) => Promise<Result> {
    return async (request, ctx) => {
      const validatedRequest = CallToolRequestSchema.safeParse(request);
      if (!validatedRequest.success) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid tools/call request: ${messageOf(validatedRequest.error)}`);
      }
      const result = await handler(request, ctx);
      if (validatedRequest.data.params.task) {
        const taskResult = CreateTaskResultSchema.safeParse(result);
        if (!taskResult.success) {
          throw new McpError(ErrorCode.InvalidParams, `Invalid task creation result: ${messageOf(taskResult.error)}`);
        }
        return taskResult.data;
      }
      const toolResult = CallToolResultSchema.safeParse(result);
      if (!toolResult.success) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid tools/call result: ${messageOf(toolResult.error)}`);
      }
      return toolResult.data;
    };
  }

  /** Send `-32002` again for the requests whose handler threw it, on a 2025-era session (see the module comment). */
  private restoreResourceNotFoundCode(transport: WrappableTransport): void {
    // A transport can serve one server after another (a recreated session): wrap its own `send`, never a wrapper
    const send = (transport[ORIGINAL_SEND] ??= transport.send.bind(transport));
    transport.send = (message, options) => send(this.withV1ResourceNotFoundCode(message), options);
  }

  private withV1ResourceNotFoundCode(message: JSONRPCMessage): JSONRPCMessage {
    if (!isJSONRPCErrorResponse(message) || !this.resourceNotFoundIds.delete(message.id as RequestId)) return message;
    const version = this.getNegotiatedProtocolVersion();
    const modern = version !== undefined && version >= FIRST_MODERN_PROTOCOL_VERSION;
    if (modern || message.error.code !== ProtocolErrorCode.InvalidParams) return message;
    return { ...message, error: { ...message.error, code: ProtocolErrorCode.ResourceNotFound } };
  }

  /** Record the version and client details of FrontMCP's `initialize` answer, as v2's own handler does. */
  private recordingInitialize(
    handler: (params: Record<string, unknown>, ctx: BaseContext) => Promise<never>,
  ): (params: Record<string, unknown>, ctx: BaseContext) => Promise<never> {
    return async (params, ctx) => {
      const result: InitializeResult = await handler(params, ctx);
      const state = this as unknown as InitializeState;
      state._clientCapabilities = params['capabilities'] as ClientCapabilities | undefined;
      state._clientVersion = params['clientInfo'] as Implementation | undefined;
      state._negotiatedProtocolVersion = result.protocolVersion;
      this.transport?.setProtocolVersion?.(result.protocolVersion);
      return result as never;
    };
  }
}
