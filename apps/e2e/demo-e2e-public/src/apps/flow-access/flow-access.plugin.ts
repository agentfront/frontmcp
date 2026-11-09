import {
  Flow,
  FlowBase,
  FlowHooksOf,
  httpInputSchema,
  HttpJsonSchema,
  httpRespond,
  Plugin,
  ScopeEntry,
  z,
  type FlowPlan,
  type FlowRunOptions,
} from '@frontmcp/sdk';

const plan = { execute: ['answer'] } as const satisfies FlowPlan<string>;
const callerInput = z.object({});
const callerOutput = z.object({ sub: z.string().nullable() });
const noState = z.object({});

declare global {
  interface ExtendFlows {
    'flow-access:public': FlowRunOptions<
      PublicRouteFlow,
      typeof plan,
      typeof httpInputSchema,
      typeof HttpJsonSchema,
      typeof noState
    >;
    'flow-access:authorized': FlowRunOptions<
      AuthorizedRouteFlow,
      typeof plan,
      typeof httpInputSchema,
      typeof HttpJsonSchema,
      typeof noState
    >;
    'flow-access:runs-caller': FlowRunOptions<
      RunsCallerRouteFlow,
      typeof plan,
      typeof httpInputSchema,
      typeof HttpJsonSchema,
      typeof noState
    >;
    'flow-access:caller': FlowRunOptions<
      CallerFlow,
      typeof plan,
      typeof callerInput,
      typeof callerOutput,
      typeof noState
    >;
  }
}

const PublicStage = FlowHooksOf('flow-access:public').Stage;
const AuthorizedStage = FlowHooksOf('flow-access:authorized').Stage;
const CallerStage = FlowHooksOf('flow-access:caller').Stage;
const RunsCallerStage = FlowHooksOf('flow-access:runs-caller').Stage;

@Flow({
  name: 'flow-access:public',
  plan,
  inputSchema: httpInputSchema,
  outputSchema: HttpJsonSchema,
  access: 'public',
  middleware: { method: 'GET', path: '/flow-access/public' },
})
class PublicRouteFlow extends FlowBase<'flow-access:public'> {
  @PublicStage('answer')
  async answer() {
    this.respond(httpRespond.json({ sub: this.tryGetContext()?.authInfo.user?.sub ?? null }));
  }
}

@Flow({
  name: 'flow-access:authorized',
  plan,
  inputSchema: httpInputSchema,
  outputSchema: HttpJsonSchema,
  access: 'authorized',
  middleware: { method: 'GET', path: '/flow-access/authorized' },
})
class AuthorizedRouteFlow extends FlowBase<'flow-access:authorized'> {
  @AuthorizedStage('answer')
  async answer() {
    this.respond(httpRespond.json({ sub: this.tryGetContext()?.authInfo.user?.sub ?? null }));
  }
}

@Flow({ name: 'flow-access:caller', plan, inputSchema: callerInput, outputSchema: callerOutput, access: 'authorized' })
class CallerFlow extends FlowBase<'flow-access:caller'> {
  @CallerStage('answer')
  async answer() {
    this.respond({ sub: this.tryGetContext()?.authInfo.user?.sub ?? null });
  }
}

@Flow({
  name: 'flow-access:runs-caller',
  plan,
  inputSchema: httpInputSchema,
  outputSchema: HttpJsonSchema,
  access: 'public',
  middleware: { method: 'GET', path: '/flow-access/runs-caller' },
})
class RunsCallerRouteFlow extends FlowBase<'flow-access:runs-caller'> {
  @RunsCallerStage('answer')
  async answer() {
    this.respond(httpRespond.json(await this.scope.runFlowForOutput('flow-access:caller', {})));
  }
}

class FlowAccessFlows {}

/** Routes whose flows declare each `access`, and `/flow-access/runs-caller`: a public route running an authorized flow. */
@Plugin({
  name: 'flow-access',
  providers: [
    {
      name: 'flow-access:flows',
      provide: FlowAccessFlows,
      inject: () => [ScopeEntry],
      useFactory: async (scope: ScopeEntry) => {
        await scope.registryFlows(PublicRouteFlow, AuthorizedRouteFlow, CallerFlow, RunsCallerRouteFlow);
        return new FlowAccessFlows();
      },
    },
  ],
})
export class FlowAccessPlugin {}
