/**
 * A validation error (`ZodError`) thrown while a request runs is that request's failure. It was taken for an
 * invalid server configuration, so a route (or any flow) that validated its input with zod answered 500
 * `server_misconfigured` with CONFIG_INVALID ("the server refuses to start").
 *
 * Both request paths are driven in process: the fetch handler (`flowErrorToHttpOutput()`), and the middleware a
 * flow registers on the Node host (`FlowInstance`), called with a recorded response.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { disposeServers } from '../../__test-utils__/helpers/oauth-flow.helpers';
import {
  App,
  Flow,
  FlowBase,
  FlowHooksOf,
  httpInputSchema,
  HttpJsonSchema,
  HttpRoute,
  Tool,
  ToolContext,
  type FlowPlan,
  type FlowRunOptions,
  type ServerRequest,
} from '../../common';
import { HttpRouteContext } from '../../common/interfaces/http-route.interface';
import type { Scope } from '../../scope/scope.instance';

const orderSchema = z.object({ orderId: z.string() });

@Tool({ name: 'find_order', inputSchema: {} })
class FindOrderTool extends ToolContext {
  async execute() {
    return orderSchema.parse({});
  }
}

@HttpRoute({ method: 'GET', path: '/orders', auth: 'public' })
class OrdersRoute extends HttpRouteContext {
  handle() {
    return orderSchema.parse(this.request.query);
  }
}

@App({ id: 'desk', name: 'Desk', tools: [FindOrderTool], routes: [OrdersRoute] })
class DeskApp {}

const lookupFlowName = 'test:order-lookup' as const;
const lookupPlan = { execute: ['lookup'] } as const satisfies FlowPlan<string>;
const lookupStateSchema = z.object({});

declare global {
  interface ExtendFlows {
    'test:order-lookup': FlowRunOptions<
      OrderLookupFlow,
      typeof lookupPlan,
      typeof httpInputSchema,
      typeof HttpJsonSchema,
      typeof lookupStateSchema
    >;
  }
}

/** Validates the request's query with zod, as a hand-written flow does. */
@Flow({
  name: lookupFlowName,
  plan: lookupPlan,
  inputSchema: httpInputSchema,
  outputSchema: HttpJsonSchema,
  access: 'public',
  middleware: { method: 'GET', path: '/order-lookup' },
})
class OrderLookupFlow extends FlowBase<typeof lookupFlowName> {
  @(FlowHooksOf(lookupFlowName).Stage('lookup'))
  async lookup() {
    orderSchema.parse(this.rawInput.request.query);
  }
}

describe('a validation error thrown while a request runs', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'desk', version: '1.0.0' }, apps: [DeskApp] });
  });

  afterAll(async () => {
    await disposeServers([server]);
  });

  it('is a plain 500 on the fetch handler when a route throws it', async () => {
    const response = await server.handler(new Request('http://localhost/orders'));

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
  });

  it('is a plain 500 in the middleware of the Node host when a flow throws it', async () => {
    const scope = server.instance.getScopes()[0] as Scope;
    const register = jest.spyOn(scope.providers.getActiveServer(), 'registerMiddleware');
    await scope.registryFlows(OrderLookupFlow);
    const middleware = register.mock.calls.find(([path]) => path === '/order-lookup')?.[1];
    const request = { method: 'GET', path: '/order-lookup', url: '/order-lookup', headers: {}, query: {} };
    const response = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), end: jest.fn() };
    const next = jest.fn();

    await middleware?.(request as ServerRequest, response as never, next);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.end).toHaveBeenCalledWith('Internal Server Error');
    expect(next).not.toHaveBeenCalled();
  });

  it('is the error of the tool call when a tool throws it', async () => {
    const { status, message } = await rpc20260728(server.handler, 'tools/call', { name: 'find_order', arguments: {} });

    expect(status).toBe(200);
    expect(message.result).toMatchObject({ isError: true, _meta: { code: 'TOOL_EXECUTION_ERROR' } });
  });
});
