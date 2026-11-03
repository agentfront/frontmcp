import 'reflect-metadata';

import {
  App,
  FrontMcp,
  httpRespond,
  HttpRoute,
  HttpRouteContext,
  HttpRouteHook,
  LoopbackTokenAuth,
  resourceStore,
  Tool,
  ToolContext,
  type HttpRouteMetadata,
  type HttpRouteResult,
  type PeopleSession,
} from '@frontmcp/sdk';

const boardStore = resourceStore();
const board = boardStore.key<string[]>('board', { initial: [] });

@HttpRoute({ method: 'GET', path: '/board/:id' })
export class BoardPage extends HttpRouteContext {
  async handle(): Promise<HttpRouteResult> {
    const person: PeopleSession | undefined = this.person;
    return { id: this.params['id'], cards: (await board.get()).value, until: person?.expiresAt };
  }
}

@HttpRoute({ method: 'GET', path: () => '/board/page', auth: 'public' })
export class BoardHtml extends HttpRouteContext {
  handle() {
    return httpRespond.html('<h1>board</h1>');
  }
}

@HttpRoute({ method: 'GET', path: '/board/events', sse: { store: boardStore, topics: [board.name], coalesceMs: 25 } })
export class BoardEvents extends HttpRouteContext {
  async handle() {
    return (await board.get()).value;
  }
}

@Tool({ name: 'sign-in-link', inputSchema: {} })
export class SignInLinkTool extends ToolContext {
  async execute() {
    const { code, expiresAt } = this.get(LoopbackTokenAuth).createCode();
    return { path: `/_frontmcp/people/login?code=${code}`, expiresAt };
  }
}

export class AuditRoutes {
  @HttpRouteHook.Will('handle')
  async audit(): Promise<void> {
    return undefined;
  }
}

@App({ name: 'board', tools: [SignInLinkTool], routes: [BoardPage, BoardHtml, BoardEvents] })
class BoardApp {}

@FrontMcp({
  info: { name: 'web-host', version: '1.0.0' },
  apps: [BoardApp],
  http: { auth: { people: 'loopback-token' } },
})
export class WebHostServer {}

@FrontMcp({
  info: { name: 'web-host-tuned', version: '1.0.0' },
  apps: [BoardApp],
  http: { auth: { people: { mode: 'loopback-token', codeTtlMs: 30_000, cookiePath: '/board' } } },
})
export class TunedWebHostServer {}

// @ts-expect-error a route needs a handle() method
@HttpRoute({ method: 'GET', path: '/nothing' })
export class RouteWithoutHandle {}

export class InvalidRoutes {
  // @ts-expect-error method is GET, POST, PUT, PATCH or DELETE
  static readonly method: HttpRouteMetadata = { method: 'TRACE', path: '/x' };
  // @ts-expect-error auth is 'people' or 'public'
  static readonly auth: HttpRouteMetadata = { method: 'GET', path: '/x', auth: 'mcp' };
}
