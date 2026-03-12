import { z, type ZodType } from 'zod';
import type {
  Notification,
  Request,
  Result,
  RequestHandlerExtra,
  McpServerOptions,
  AuthInfo,
} from '@frontmcp/protocol';
import type { LocalTransporter } from '../transport.local';
import type { Authorization } from '../../common';
import type { Scope } from '../../scope';

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
