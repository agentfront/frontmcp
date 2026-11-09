/**
 * `@Flow({ access })`: an `'authorized'` flow runs only for a caller the server's auth admitted, and is refused before
 * its first stage otherwise; a `'public'` flow runs for anyone. Over HTTP the caller is admitted when `session:verify`
 * accepts the request: `http:request` verifies every MCP request, and a flow that serves a request no flow verified (a
 * flow on its own route, or one such a flow runs) verifies it itself. In process (`connect()`, a direct call) the
 * caller is the server process.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  createTestJwtIssuer,
  rpc20260728,
  type TestFetchServer,
  type TestJwtIssuer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  Flow,
  FlowBase,
  FlowHooksOf,
  httpInputSchema,
  HttpJsonSchema,
  httpRespond,
  LogLevel,
  Plugin,
  ScopeEntry,
  Tool,
  ToolContext,
  type FlowPlan,
  type FlowRunOptions,
  type FrontMcpConfigInput,
} from '../../common';
import { connect } from '../../direct/connect';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const stagesRun: string[] = [];
const routePlan = { execute: ['answer'] } as const satisfies FlowPlan<string>;
const callerPlan = { execute: ['answer'] } as const satisfies FlowPlan<string>;
const callerInput = z.object({});
const callerOutput = z.object({ sub: z.string().nullable() });
const noState = z.object({});

declare global {
  interface ExtendFlows {
    'flow-access:public-route': FlowRunOptions<
      PublicRouteFlow,
      typeof routePlan,
      typeof httpInputSchema,
      typeof HttpJsonSchema,
      typeof noState
    >;
    'flow-access:authorized-route': FlowRunOptions<
      AuthorizedRouteFlow,
      typeof routePlan,
      typeof httpInputSchema,
      typeof HttpJsonSchema,
      typeof noState
    >;
    'flow-access:route-runs-caller': FlowRunOptions<
      RouteRunsCallerFlow,
      typeof routePlan,
      typeof httpInputSchema,
      typeof HttpJsonSchema,
      typeof noState
    >;
    'flow-access:caller': FlowRunOptions<
      CallerFlow,
      typeof callerPlan,
      typeof callerInput,
      typeof callerOutput,
      typeof noState
    >;
  }
}

const PublicRouteStage = FlowHooksOf('flow-access:public-route').Stage;
const AuthorizedRouteStage = FlowHooksOf('flow-access:authorized-route').Stage;
const RouteRunsCallerStage = FlowHooksOf('flow-access:route-runs-caller').Stage;
const CallerStage = FlowHooksOf('flow-access:caller').Stage;

@Flow({
  name: 'flow-access:public-route',
  plan: routePlan,
  inputSchema: httpInputSchema,
  outputSchema: HttpJsonSchema,
  access: 'public',
  middleware: { method: 'GET', path: '/flow-access/public' },
})
class PublicRouteFlow extends FlowBase<'flow-access:public-route'> {
  @PublicRouteStage('answer')
  async answer() {
    stagesRun.push('flow-access:public-route');
    this.respond(httpRespond.json({ sub: this.tryGetContext()?.authInfo.user?.sub ?? null }));
  }
}

@Flow({
  name: 'flow-access:authorized-route',
  plan: routePlan,
  inputSchema: httpInputSchema,
  outputSchema: HttpJsonSchema,
  access: 'authorized',
  middleware: { method: 'GET', path: '/flow-access/authorized' },
})
class AuthorizedRouteFlow extends FlowBase<'flow-access:authorized-route'> {
  @AuthorizedRouteStage('answer')
  async answer() {
    stagesRun.push('flow-access:authorized-route');
    this.respond(httpRespond.json({ sub: this.tryGetContext()?.authInfo.user?.sub ?? null }));
  }
}

@Flow({
  name: 'flow-access:caller',
  plan: callerPlan,
  inputSchema: callerInput,
  outputSchema: callerOutput,
  access: 'authorized',
})
class CallerFlow extends FlowBase<'flow-access:caller'> {
  @CallerStage('answer')
  async answer() {
    stagesRun.push('flow-access:caller');
    this.respond({ sub: this.tryGetContext()?.authInfo.user?.sub ?? null });
  }
}

@Flow({
  name: 'flow-access:route-runs-caller',
  plan: routePlan,
  inputSchema: httpInputSchema,
  outputSchema: HttpJsonSchema,
  access: 'public',
  middleware: { method: 'GET', path: '/flow-access/runs-caller' },
})
class RouteRunsCallerFlow extends FlowBase<'flow-access:route-runs-caller'> {
  @RouteRunsCallerStage('answer')
  async answer() {
    const caller = await this.scope.runFlowForOutput('flow-access:caller', {});
    this.respond(httpRespond.json(caller));
  }
}

class FlowAccessFlows {}

@Plugin({
  name: 'flow-access',
  providers: [
    {
      name: 'flow-access:flows',
      provide: FlowAccessFlows,
      inject: () => [ScopeEntry],
      useFactory: async (scope: ScopeEntry) => {
        await scope.registryFlows(PublicRouteFlow, AuthorizedRouteFlow, RouteRunsCallerFlow, CallerFlow);
        return new FlowAccessFlows();
      },
    },
  ],
})
class FlowAccessPlugin {}

@Tool({ name: 'whose_flow', inputSchema: {} })
class WhoseFlowTool extends ToolContext {
  async execute() {
    return this.scope.runFlowForOutput('flow-access:caller', {});
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoseFlowTool], plugins: [FlowAccessPlugin] })
class DeskApp {}

const STATIC_KEY = 'sk-flow-access-static-key-0001';
const AUDIENCE = 'flow-access-desk';

function config(auth?: FrontMcpConfigInput['auth']): FrontMcpConfigInput {
  return {
    info: { name: 'flow-access', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
    ...(auth ? { auth } : {}),
  };
}

function transparent(issuer: TestJwtIssuer, requiredScopes: string[] = []): FrontMcpConfigInput['auth'] {
  return {
    mode: 'transparent',
    provider: issuer.issuer,
    providerConfig: { jwks: issuer.jwks },
    expectedAudience: AUDIENCE,
    requiredScopes,
  };
}

async function get(server: TestFetchServer, path: string, token?: string) {
  const response = await server.handler(
    new Request(`http://localhost${path}`, token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  );
  return { status: response.status, challenge: response.headers.get('www-authenticate'), body: await response.json() };
}

function structured(result: unknown): unknown {
  return (result as { structuredContent?: unknown }).structuredContent;
}

describe("@Flow({ access: 'authorized' }) refuses a caller the server's auth did not admit", () => {
  let issuer: TestJwtIssuer;
  let server: TestFetchServer;

  beforeAll(async () => {
    issuer = await createTestJwtIssuer();
    server = await createTestFetchServer(config(transparent(issuer)));
  });

  afterAll(() => server.instance.shutdown());

  beforeEach(() => {
    stagesRun.length = 0;
  });

  it('answers 401 with the challenge on its own route, before its first stage, without a token', async () => {
    const answer = await get(server, '/flow-access/authorized');

    expect(answer.status).toBe(401);
    expect(answer.challenge).toContain('Bearer');
    expect(answer.body).toEqual({ error: 'Unauthorized' });
    expect(stagesRun).toEqual([]);
  });

  it('answers 401 for a token the server does not accept', async () => {
    const forged = await (await createTestJwtIssuer(issuer.issuer)).sign({ aud: AUDIENCE }, 'mallory');

    expect((await get(server, '/flow-access/authorized', forged)).status).toBe(401);
    expect(stagesRun).toEqual([]);
  });

  it('runs for a verified caller, who becomes the run context caller', async () => {
    const token = await issuer.sign({ aud: AUDIENCE }, 'alice');

    expect(await get(server, '/flow-access/authorized', token)).toMatchObject({ status: 200, body: { sub: 'alice' } });
  });

  it('answers 403 with the challenge for a token without the scopes the server requires', async () => {
    const scoped = await createTestFetchServer(config(transparent(issuer, ['flows:run'])));
    try {
      const token = await issuer.sign({ aud: AUDIENCE, scope: 'other' }, 'alice');
      const answer = await get(scoped, '/flow-access/authorized', token);

      expect(answer.status).toBe(403);
      expect(answer.challenge).toContain('insufficient_scope');
      expect(stagesRun).toEqual([]);
    } finally {
      await scoped.instance.shutdown();
    }
  });

  it('checks a flow another flow runs against the original caller: an unverified request is verified', async () => {
    const token = await issuer.sign({ aud: AUDIENCE }, 'alice');

    expect((await get(server, '/flow-access/runs-caller')).status).toBe(401);
    expect(stagesRun).toEqual([]);
    expect(await get(server, '/flow-access/runs-caller', token)).toMatchObject({ status: 200, body: { sub: 'alice' } });
  });

  it('runs for the MCP client http:request verified, from a tool', async () => {
    const token = await issuer.sign({ aud: AUDIENCE }, 'alice');

    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'whose_flow', arguments: {} },
      { headers: { authorization: `Bearer ${token}` } },
    );

    expect(structured(message.result)).toEqual({ sub: 'alice' });
  });
});

describe("@Flow({ access: 'public' }) runs for any caller", () => {
  it('answers on its own route without a token, in a mode that requires one', async () => {
    const issuer = await createTestJwtIssuer();
    const server = await createTestFetchServer(config(transparent(issuer)));
    try {
      expect(await get(server, '/flow-access/public')).toMatchObject({ status: 200, body: { sub: null } });
    } finally {
      await server.instance.shutdown();
    }
  });
});

describe("the anonymous callers a server's auth admits are authorized", () => {
  it('runs an authorized flow for an anonymous caller in public mode', async () => {
    const server = await createTestFetchServer(config({ mode: 'public' }));
    try {
      const answer = await get(server, '/flow-access/authorized');

      expect(answer.status).toBe(200);
      expect(answer.body.sub).toMatch(/^anon:/);
    } finally {
      await server.instance.shutdown();
    }
  });

  it('runs an authorized flow for a static-key caller, and refuses a wrong key', async () => {
    const server = await createTestFetchServer(config({ mode: 'static', tokens: [STATIC_KEY] }));
    try {
      expect((await get(server, '/flow-access/authorized', 'sk-wrong-key')).status).toBe(401);
      expect((await get(server, '/flow-access/authorized', STATIC_KEY)).status).toBe(200);
    } finally {
      await server.instance.shutdown();
    }
  });
});

describe('an in-process caller is the server process, and is authorized', () => {
  it('runs an authorized flow for a connect() client without a token, in a mode that requires one', async () => {
    const issuer = await createTestJwtIssuer();
    const client = await connect(config(transparent(issuer)));
    try {
      expect(structured(await client.callTool('whose_flow', {}))).toEqual({ sub: null });
    } finally {
      await client.close();
    }
  });

  it('runs an authorized flow for a direct call', async () => {
    const server = await FrontMcpInstance.createDirect(config());
    try {
      expect(structured(await server.callTool('whose_flow', {}))).toEqual({ sub: 'direct' });
    } finally {
      await server.dispose();
    }
  });
});
