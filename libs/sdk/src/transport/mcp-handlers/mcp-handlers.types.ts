import { type z, type ZodType } from '@frontmcp/lazy-zod';
import type {
  AuthInfo,
  McpServerOptions,
  Notification,
  Request,
  RequestHandlerExtra,
  Result,
} from '@frontmcp/protocol';

import type { Authorization } from '../../common';
import type { Scope } from '../../scope';
import type { LocalTransporter } from '../transport.local';

type Primitive = string | number | boolean | bigint | null | undefined;
type Flatten<T> = T extends Primitive
  ? T
  : T extends Array<infer U>
    ? Array<Flatten<U>>
    : T extends Set<infer U>
      ? Set<Flatten<U>>
      : T extends Map<infer K, infer V>
        ? Map<Flatten<K>, Flatten<V>>
        : T extends object
          ? {
              [K in keyof T]: Flatten<T[K]>;
            }
          : T;
type Infer<Schema extends ZodType> = Flatten<z.infer<Schema>>;

export interface McpHandler<
  HandlerRequest extends Request = Request,
  HandlerResult extends Result = Result,
  In extends z.ZodObject<any> = z.ZodObject<any>,
  Out extends z.ZodObject<any> = z.ZodObject<any>,
  HandlerNotification extends Notification = Notification,
> {
  when?: (request: Infer<In>) => boolean;
  requestSchema: In;
  responseSchema?: Out;

  handler: (
    request: HandlerRequest,
    ctx: McpRequestHandler<HandlerRequest, HandlerNotification>,
  ) => Promise<HandlerResult> | HandlerResult;
}

export type McpHandlerOptions = {
  scope: Scope;
  serverOptions: McpServerOptions;
  /**
   * Lazily compose the `initialize` response's `instructions` field.
   *
   * When provided, the `initialize` handler invokes this on every request so
   * the catalog reflects skills registered AFTER server boot (e.g. dynamic
   * `registerSkillContent` calls). When omitted, the handler falls back to
   * the static `serverOptions.instructions` baked at construction time.
   *
   * Must remain synchronous — the MCP `initialize` request must respond
   * promptly without round-tripping to slow stores.
   */
  composeInstructions?: () => string | undefined;
};

export type McpRequestHandler<
  SendRequestT extends Request,
  SendNotificationT extends Notification,
> = RequestHandlerExtra<SendRequestT, SendNotificationT> & {
  authInfo?: AuthInfo & {
    extra?: {
      [key: string]: unknown;
      transport: LocalTransporter;
      authSession: Authorization;
    };
  };
};
