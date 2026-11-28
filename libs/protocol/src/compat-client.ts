/**
 * The MCP `Client` FrontMCP uses: v2's `Client`, with v1's handler registration and `callTool` arguments.
 *
 * - `setRequestHandler(schema, handler)` and `setNotificationHandler(schema, handler)` take a v1 zod schema, as on
 *   the server (see `compat-handlers.ts`). A method name (the v2 form) still works.
 * - `callTool(params, resultSchema?, options?)` keeps v1's three arguments. v2 takes `(params, options)` and
 *   validates the result itself, so a result schema passed as the second argument is dropped.
 */
import {
  Client as V2Client,
  type BaseContext,
  type CallToolRequest,
  type CallToolResult,
  type ClientContext,
  type ClientOptions,
  type Transport as ClientTransport,
  type ConnectOptions,
  type Implementation,
  type RequestOptions,
  type MessageExtraInfo as V2MessageExtraInfo,
} from '@modelcontextprotocol/client';
import type { Transport as ServerTransport } from '@modelcontextprotocol/server';

import {
  adaptNotificationHandler,
  adaptRequestHandler,
  isMethodSchema,
  methodOfSchema,
  PASS_THROUGH_PARAMS,
  withTransportInfo,
  type V1NotificationHandler,
  type V1RequestHandler,
} from './compat-handlers';

export type { ClientOptions };

type V2SetHandler = (method: string, ...rest: unknown[]) => void;

function isStandardSchema(value: unknown): boolean {
  return typeof value === 'object' && value !== null && '~standard' in value;
}

export class Client extends V2Client {
  constructor(clientInfo: Implementation, options?: ClientOptions) {
    super(clientInfo, options);
  }

  /**
   * Accepts a transport typed by `@modelcontextprotocol/server` too (such as `InMemoryTransport`): each v2 package
   * declares its own copy of the `Transport` type, and FrontMCP widens the server's `AuthInfo`.
   */
  override connect(transport: ClientTransport | ServerTransport, options?: ConnectOptions): Promise<void> {
    return super.connect(transport as ClientTransport, options);
  }

  protected override buildContext(ctx: BaseContext, transportInfo?: V2MessageExtraInfo): ClientContext {
    return withTransportInfo(super.buildContext(ctx, transportInfo), transportInfo);
  }

  // v1: (requestSchema, handler). v2: (method, handler) or (method, schemas, handler).
  override setRequestHandler(...args: unknown[]): void {
    const [first, second, third] = args;
    const v2SetRequestHandler = super.setRequestHandler.bind(this) as V2SetHandler;
    if (!isMethodSchema(first)) {
      v2SetRequestHandler(first as string, second, third);
      return;
    }
    const method = methodOfSchema(first);
    v2SetRequestHandler(
      method,
      { params: PASS_THROUGH_PARAMS },
      adaptRequestHandler(first, method, second as V1RequestHandler),
    );
  }

  // v1: (notificationSchema, handler). v2: (method, handler) or (method, schemas, handler).
  override setNotificationHandler(...args: unknown[]): void {
    const [first, second, third] = args;
    const v2SetNotificationHandler = super.setNotificationHandler.bind(this) as V2SetHandler;
    if (!isMethodSchema(first)) {
      v2SetNotificationHandler(first as string, second, third);
      return;
    }
    v2SetNotificationHandler(
      methodOfSchema(first),
      { params: PASS_THROUGH_PARAMS },
      adaptNotificationHandler(first, second as V1NotificationHandler),
    );
  }

  /** v1 signature: `callTool(params, resultSchema?, options?)`; v2's `callTool(params, options)` still works. */
  override callTool(
    params: CallToolRequest['params'],
    resultSchemaOrOptions?: unknown,
    options?: RequestOptions,
  ): Promise<CallToolResult> {
    const v2Options =
      resultSchemaOrOptions === undefined || isStandardSchema(resultSchemaOrOptions)
        ? options
        : (resultSchemaOrOptions as RequestOptions);
    return super.callTool(params, v2Options);
  }
}
