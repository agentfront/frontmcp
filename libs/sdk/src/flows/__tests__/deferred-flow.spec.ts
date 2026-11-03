/**
 * A deferred flow is registered under its name and route like any flow, and its class loads the first time a request
 * reaches the route or the flow runs (#950). Hooks on its stages run as they do on a flow registered by its class.
 */
import 'reflect-metadata';

import { z, ZodError } from '@frontmcp/lazy-zod';

import {
  Flow,
  FlowBase,
  FlowHooksOf,
  LogLevel,
  Plugin,
  type FlowPlan,
  type FlowRunOptions,
  type FlowType,
  type ServerRequest,
} from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { Scope } from '../../scope/scope.instance';
import { runMatchingHttpFlowWeb } from '../../transport/web-fetch-handler';
import { deferredFlow } from '../deferred-flow';

const name = 'test:deferred-greet' as const;
const inputSchema = z.object({ name: z.string() });
const outputSchema = z.object({ message: z.string() });
const stateSchema = z.object({});
const plan = { execute: ['greet'] } as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'test:deferred-greet': FlowRunOptions<
      GreetFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
    'test:deferred-guarded': FlowRunOptions<
      GuardedFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const GreetHook = FlowHooksOf(name);

@Flow({ name, plan, inputSchema, outputSchema, access: 'public', middleware: { method: 'POST', path: '/greet' } })
class GreetFlow extends FlowBase<typeof name> {
  @GreetHook.Stage('greet')
  async greet() {
    this.respond({ message: `Hello, ${this.input.name}` });
  }
}

const routeGuard = jest.fn(async () => true);
const classGuard = jest.fn(async () => true);

@Flow({
  name: 'test:deferred-guarded',
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
  middleware: { path: '/guarded', canActivate: [routeGuard] },
})
class GuardedFlow extends FlowBase<'test:deferred-guarded'> {
  static canActivate = classGuard;

  @(FlowHooksOf('test:deferred-guarded').Stage('greet'))
  async greet() {
    this.respond({ message: 'guarded' });
  }
}

const hooked: string[] = [];

@Plugin({ name: 'greet-hooks' })
class GreetHooksPlugin {
  @GreetHook.Will('greet')
  willGreet() {
    hooked.push('will greet');
  }
}

function request(method: ServerRequest['method'], path: string): ServerRequest {
  return { method, path, url: path, headers: {}, query: {}, body: undefined } as ServerRequest;
}

describe('deferredFlow', () => {
  let scope: Scope;
  let load: jest.Mock<Promise<FlowType>, []>;

  beforeEach(async () => {
    hooked.length = 0;
    routeGuard.mockClear();
    classGuard.mockClear();
    load = jest.fn(async () => GreetFlow);
    const frontMcp = await FrontMcpInstance.createForGraph({
      info: { name: 'deferred-flow', version: '1.0.0' },
      apps: [],
      plugins: [GreetHooksPlugin],
      logging: { level: LogLevel.Off },
    });
    scope = frontMcp.getScopes()[0] as Scope;
    await scope.registryFlows(deferredFlow({ name, middleware: { method: 'POST', path: '/greet' } }, load));
  });

  it('registers the flow without loading its class', () => {
    expect(load).not.toHaveBeenCalled();
  });

  it('loads its class once when it runs, and runs its stages and hooks', async () => {
    const [first, second] = await Promise.all([
      scope.runFlowForOutput(name, { name: 'Ada' }),
      scope.runFlowForOutput(name, { name: 'Lin' }),
    ]);

    expect(first).toEqual({ message: 'Hello, Ada' });
    expect(second).toEqual({ message: 'Hello, Lin' });
    expect(hooked).toEqual(['will greet', 'will greet']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('validates input with the schema of the class it loads', async () => {
    await expect(scope.runFlowForOutput(name, { name: 42 } as never)).rejects.toThrow(ZodError);
  });

  it('leaves its class unloaded for a request to another route or with another method', async () => {
    await scope.findHttpFlowName(request('POST', '/elsewhere'));
    await scope.findHttpFlowName(request('GET', '/greet'));

    expect(load).not.toHaveBeenCalled();
  });

  it('runs each guard of the class it loads once per request', async () => {
    await scope.registryFlows(
      deferredFlow({ name: 'test:deferred-guarded', middleware: { path: '/guarded' } }, async () => GuardedFlow),
    );

    await scope.findHttpFlowName(request('GET', '/guarded'));
    await scope.findHttpFlowName(request('GET', '/guarded'));

    expect(routeGuard).toHaveBeenCalledTimes(2);
    expect(classGuard).toHaveBeenCalledTimes(2);
  });

  it('loads its class to answer a request to its route', async () => {
    await expect(scope.findHttpFlowName(request('POST', '/greet'))).resolves.toBe(name);

    expect(load).toHaveBeenCalledTimes(1);
  });

  describe('when its class fails to load', () => {
    const failingName = 'test:deferred-guarded' as const;
    const failedLoad = async (): Promise<FlowType> => {
      throw new Error('flow module failed to load');
    };
    const failing = () => deferredFlow({ name: failingName, middleware: { path: '/failing' } }, failedLoad);

    it('answers a Web request to its route with a 500', async () => {
      await scope.registryFlows(failing());

      const response = await runMatchingHttpFlowWeb(scope, new Request('http://localhost/failing'));

      expect(response?.status).toBe(500);
    });

    it('answers a request its middleware receives with a 500', async () => {
      const server = scope.providers.getActiveServer();
      const register = jest.spyOn(server, 'registerMiddleware');
      await scope.registryFlows(failing());
      const handler = register.mock.calls.find(([path]) => path === '/failing')?.[1];
      const response = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), end: jest.fn() };
      const next = jest.fn();

      await handler?.(request('GET', '/failing'), response as never, next);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
