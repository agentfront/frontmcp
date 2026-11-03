import type { PeopleSession } from '@frontmcp/auth';

import type { HttpOutput } from '../schemas/http-output.schema';
import { ExecutionContextBase, type ExecutionContextBaseArgs } from './execution-context.interface';
import type { ServerRequest } from './server.interface';

/**
 * What `handle()` answers: an output from `httpRespond` (HTML, a redirect, a status of your own), an object or array
 * (JSON), a string (plain text), or nothing (204). On an SSE route it is the view to send; nothing sends none.
 */
export type HttpRouteResult = HttpOutput | Record<string, unknown> | readonly unknown[] | string | undefined | void;

export interface HttpRouteInterface {
  handle(): HttpRouteResult | Promise<HttpRouteResult>;
}

export interface HttpRouteCtorArgs extends ExecutionContextBaseArgs {
  request: ServerRequest;
  person?: PeopleSession;
}

/** An `@HttpRoute` class: listed in `@App({ routes })`. */
export type HttpRouteType = abstract new (args: HttpRouteCtorArgs) => HttpRouteInterface;

/**
 * The base of an `@HttpRoute` class. `this.get()` resolves the providers of the route's app, the ones its tools get.
 *
 * @example
 * ```typescript
 * @HttpRoute({ method: 'GET', path: '/board/:id' })
 * export class BoardPage extends HttpRouteContext {
 *   async handle() {
 *     return this.get(BoardService).find(this.params['id']);
 *   }
 * }
 * ```
 */
export abstract class HttpRouteContext extends ExecutionContextBase<HttpRouteResult> implements HttpRouteInterface {
  /** The request: method, path, headers, query and parsed body. */
  readonly request: ServerRequest;
  /** The signed-in person, on a `'people'` or `'subject'` route; `person.subject` on a `'subject'` one. */
  readonly person?: PeopleSession;

  constructor(args: HttpRouteCtorArgs) {
    super(args);
    this.request = args.request;
    this.person = args.person;
  }

  /** The parameters of the route's path (`id` in `/board/:id`). */
  get params(): Record<string, string> {
    return this.request.params ?? {};
  }

  abstract handle(): HttpRouteResult | Promise<HttpRouteResult>;
}
