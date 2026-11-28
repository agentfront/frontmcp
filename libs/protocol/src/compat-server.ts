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
 */
import { CallToolRequestSchema, CreateTaskResultSchema } from '@modelcontextprotocol/core';
import {
  Server as V2Server,
  type BaseContext,
  type ClientCapabilities,
  type Implementation,
  type InitializeResult,
  type JSONRPCRequest,
  type Result,
  type ServerContext,
  type ServerOptions,
  type MessageExtraInfo as V2MessageExtraInfo,
} from '@modelcontextprotocol/server';

import { ErrorCode, McpError } from './compat-errors';
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class Server extends V2Server {
  constructor(serverInfo: Implementation, options?: ServerOptions) {
    super(serverInfo, options);
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
    if (method !== 'tools/call') return super._wrapHandler(method, handler);
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
