/**
 * The MCP `Client` FrontMCP uses: v2's `Client`, with v1's handler registration and `callTool` arguments.
 *
 * - `setRequestHandler(schema, handler)` and `setNotificationHandler(schema, handler)` take a v1 zod schema, as on
 *   the server (see `compat-handlers.ts`). A method name (the v2 form) still works.
 * - `callTool(params, resultSchema?, options?)` keeps v1's three arguments. v2 takes `(params, options)` and
 *   validates the result itself, so a result schema passed as the second argument is dropped.
 * - An error a server answered with `-32002` keeps that code. v2 turns a `-32002` whose data names a `uri` into its
 *   `ResourceNotFoundError`, whose code is `-32602`; v1 kept the server's code.
 */
import {
  isJSONRPCErrorResponse,
  ProtocolErrorCode,
  SdkHttpError,
  Client as V2Client,
  StreamableHTTPClientTransport as V2StreamableHTTPClientTransport,
  type BaseContext,
  type CallToolRequest,
  type CallToolResult,
  type ClientContext,
  type ClientOptions,
  type Transport as ClientTransport,
  type ConnectOptions,
  type Implementation,
  type JSONRPCErrorResponse,
  type JSONRPCResponse,
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
/** v2's map of the handlers waiting for a response, by request id. */
type ResponseHandlers = Map<number, (response: unknown) => void>;

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

  protected override _onresponse(response: JSONRPCResponse | JSONRPCErrorResponse): void {
    if (isJSONRPCErrorResponse(response) && response.error.code === ProtocolErrorCode.ResourceNotFound) {
      const handlers = (this as unknown as { _responseHandlers: ResponseHandlers })._responseHandlers;
      const id = Number(response.id);
      const handler = handlers.get(id);
      if (handler) {
        // v2 settles an error response with a ProtocolError built from it; give it back the server's code
        handlers.set(id, (error) =>
          handler(
            Object.defineProperty(Object(error), 'code', { value: ProtocolErrorCode.ResourceNotFound, writable: true }),
          ),
        );
      }
    }
    super._onresponse(response);
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

/**
 * v1's Streamable HTTP client failed a request the server refused with an error whose numeric `code` was the HTTP
 * status. v2's `SdkHttpError` keeps the status in `status` (its `code` is a string), so this transport also records it
 * as `http.status`, where FrontMCP's remote client reads it to retry (408, 429, 5xx) or fail with `RemoteAuthError`
 * (401).
 */
export class StreamableHTTPClientTransport extends V2StreamableHTTPClientTransport {
  override async send(...args: Parameters<V2StreamableHTTPClientTransport['send']>): Promise<void> {
    try {
      await super.send(...args);
    } catch (error) {
      if (SdkHttpError.isInstance(error) && typeof error.status === 'number' && !('http' in error)) {
        Object.defineProperty(error, 'http', {
          value: { status: error.status },
          enumerable: false,
          writable: true,
          configurable: true,
        });
      }
      throw error;
    }
  }
}
