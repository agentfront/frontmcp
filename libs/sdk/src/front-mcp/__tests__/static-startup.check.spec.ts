/**
 * `assertStaticStartupConfig` runs the startup checks a server config's metadata settles, for entry
 * points that build the server later than they are created (on an edge isolate). It must never
 * refuse a server the full checks, run when the server is built, accept.
 */
import 'reflect-metadata';

import {
  Agent,
  AgentContext,
  App,
  FlowHooksOf,
  LogLevel,
  Plugin,
  ResourceContext,
  ResourceTemplate,
  Skill,
  Tool,
  ToolContext,
  type FrontMcpConfigInput,
  type HookMetadata,
} from '../../common';
import { registerPendingTC39Hook, resolvePendingTC39HooksForClass } from '../../common/decorators/hook.decorator';
import { AuthConfigurationError, UnenforcedMetadataError } from '../../errors';
import { FrontMcpInstance } from '../front-mcp';
import { assertStaticStartupConfig } from '../static-startup.check';

const ToolHook = FlowHooksOf('tools:call-tool');

// The plugin fields are declared by the plugin packages' type augmentation, which these tests do not load.
const APPROVAL: Record<string, unknown> = { approval: true };
const BETA_FLAG: Record<string, unknown> = { featureFlag: 'beta' };

function tool(name: string, extra: Record<string, unknown> = {}) {
  @Tool({ name, inputSchema: {}, ...extra })
  class NamedTool extends ToolContext {
    async execute() {
      return { ok: true };
    }
  }
  return NamedTool;
}

@ResourceTemplate({ name: 'ticket', uriTemplate: 'tickets://{id}', mimeType: 'text/plain', authorities: 'admin' })
class TicketTemplate extends ResourceContext<{ id: string }> {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'secret' }] };
  }
}

@Skill({ name: 'beta-runbook', description: 'Beta runbook', instructions: 'Beta steps.', ...BETA_FLAG })
class BetaRunbookSkill {}

/** Enforces `approval` on the tools of every app with no instance of it (like `ApprovalPlugin`). */
@Plugin({ name: 'any-app-approval', enforcesMetadata: ['approval'] })
class AnyAppApprovalPlugin {
  @ToolHook.Will('execute', { appliesTo: 'uncovered-apps' })
  gate() {
    // enforcement itself is not under test here
  }
}

/** Enforces `approval` on the tools of the app it is installed on only (the default `appliesTo`). */
@Plugin({ name: 'own-app-approval', enforcesMetadata: ['approval'] })
class OwnAppApprovalPlugin {
  @ToolHook.Will('execute')
  gate() {
    // enforcement itself is not under test here
  }
}

/** Enforces `approval` on the tools of every app, from whichever app it is installed on. */
@Plugin({ name: 'server-scoped-approval', scope: 'server', enforcesMetadata: ['approval'] })
class ServerScopedApprovalPlugin {
  @ToolHook.Will('execute')
  gate() {
    // enforcement itself is not under test here
  }
}

/** Wraps an approval gate and is installed as a value, as `ApprovalPlugin.init()` installs its check plugin. */
function wrappedGate(gate: new () => object) {
  @Plugin({ name: 'approval-suite', plugins: [gate] })
  class ApprovalSuitePlugin {}
  return { provide: ApprovalSuitePlugin, useValue: new ApprovalSuitePlugin() };
}

/** Declares that it enforces `approval` but has no hook that does. */
@Plugin({ name: 'hookless-approval', enforcesMetadata: ['approval'] })
class HooklessApprovalPlugin {}

/** Contributes a tool that asks for approval, and enforces nothing. */
@Plugin({ name: 'queue-tools', tools: [tool('purge_queue', APPROVAL)] })
class QueueToolsPlugin {}

const llm = { adapter: { completion: async () => ({ content: 'done', finishReason: 'stop' as const }) } };

@Agent({ name: 'refunds', inputSchema: {}, llm, authorities: 'admin' })
class RefundsAgent extends AgentContext {}

/** An agent whose own tool asks for approval, with the given agent options. */
function refundDeskAgent(extra: Record<string, unknown> = {}) {
  @Agent({ name: 'refund-desk', inputSchema: {}, llm, tools: [tool('issue_refund', APPROVAL)], ...extra })
  class RefundDeskAgent extends AgentContext {}
  return RefundDeskAgent;
}

/** An agent with a plugin that enforces approval, with the given agent options. */
function approvingTriageAgent(extra: Record<string, unknown> = {}) {
  @Agent({ name: 'triage', inputSchema: {}, llm, plugins: [AnyAppApprovalPlugin], ...extra })
  class ApprovingTriageAgent extends AgentContext {}
  return ApprovingTriageAgent;
}

function app(id: string, entries: Record<string, unknown>) {
  @App({ id, name: id, ...entries })
  class NamedApp {}
  return NamedApp;
}

function server(extra: Record<string, unknown>): FrontMcpConfigInput {
  return {
    info: { name: 'static-startup', version: '1.0.0' },
    logging: { level: LogLevel.Off },
    apps: [],
    ...extra,
  } as FrontMcpConfigInput;
}

const AUTHORITIES = { claimsMapping: { roles: 'roles' }, profiles: { admin: { roles: { any: ['admin'] } } } };
const AUDITOR = { roles: { any: ['auditor'] } };

/** Servers the full checks accept. */
const ACCEPTED: Array<[string, FrontMcpConfigInput]> = [
  [
    'an approval tool on an app a plugin on another app covers',
    server({
      apps: [
        app('billing', { tools: [tool('refund_invoice', APPROVAL)] }),
        app('desk', { plugins: [AnyAppApprovalPlugin] }),
      ],
    }),
  ],
  [
    "an approval tool on an app a scope: 'server' plugin on another app covers",
    server({
      apps: [
        app('billing', { tools: [tool('refund_invoice', APPROVAL)] }),
        app('desk', { plugins: [ServerScopedApprovalPlugin] }),
      ],
    }),
  ],
  [
    'an approval tool this process does not serve',
    server({
      apps: [app('billing', { tools: [tool('deno_refund', { ...APPROVAL, availableWhen: { runtime: ['deno'] } })] })],
    }),
  ],
  [
    'a tool whose approval is off',
    server({ apps: [app('billing', { tools: [tool('refund', { approval: false })] })] }),
  ],
  [
    'authorities with the authorities option',
    server({ apps: [app('desk', { resources: [TicketTemplate] })], authorities: AUTHORITIES }),
  ],
  [
    'a server-level approval tool a server-level plugin gates',
    server({ apps: [app('desk', {})], tools: [tool('shared_refund', APPROVAL)], plugins: [OwnAppApprovalPlugin] }),
  ],
  [
    'a server-level approval tool, and a gate for uncovered apps on an app',
    server({ apps: [app('desk', { plugins: [AnyAppApprovalPlugin] })], tools: [tool('shared_refund', APPROVAL)] }),
  ],
  [
    'an approval tool on an app, and a gate for uncovered apps nested in a plugin value on another app',
    server({
      apps: [
        app('billing', { tools: [tool('refund_invoice', APPROVAL)] }),
        app('desk', { plugins: [wrappedGate(AnyAppApprovalPlugin)] }),
      ],
    }),
  ],
  [
    'an approval tool on an app whose own plugin gates only that app',
    server({ apps: [app('billing', { tools: [tool('refund_invoice', APPROVAL)], plugins: [OwnAppApprovalPlugin] })] }),
  ],
  [
    'an approval tool a plugin contributes to an app whose other plugin gates only that app',
    server({ apps: [app('ops', { plugins: [QueueToolsPlugin, OwnAppApprovalPlugin] })] }),
  ],
  [
    'an approval tool on an app, and a server-level plugin that gates only its own apps',
    server({ apps: [app('billing', { tools: [tool('refund_invoice', APPROVAL)] })], plugins: [OwnAppApprovalPlugin] }),
  ],
  [
    'an approval tool inside an agent whose own plugin declares approval without a hook',
    server({ apps: [app('desk', { agents: [refundDeskAgent({ plugins: [HooklessApprovalPlugin] })] })] }),
  ],
  [
    'an approval tool inside an agent whose own plugin enforces approval',
    server({ apps: [app('desk', { agents: [refundDeskAgent({ plugins: [AnyAppApprovalPlugin] })] })] }),
  ],
  [
    'an approval tool inside an agent that inherits the plugins of its app, which enforces approval',
    server({
      apps: [
        app('desk', {
          plugins: [OwnAppApprovalPlugin],
          agents: [refundDeskAgent({ execution: { inheritPlugins: true } })],
        }),
      ],
    }),
  ],
  [
    'an approval tool inside an agent that inherits plugins, and a server-level plugin enforces approval',
    server({
      apps: [app('desk', { agents: [refundDeskAgent({ execution: { inheritPlugins: true } })] })],
      plugins: [OwnAppApprovalPlugin],
    }),
  ],
];

/** Servers the full checks refuse, and the metadata alone shows why. */
const REFUSED: Array<[string, FrontMcpConfigInput, new (...args: never[]) => Error]> = [
  [
    'a tool a plugin contributes asks for approval',
    server({ apps: [app('ops', { plugins: [QueueToolsPlugin] })] }),
    UnenforcedMetadataError,
  ],
  [
    'a server-level skill has a feature flag',
    server({ apps: [app('desk', {})], skills: [BetaRunbookSkill] }),
    UnenforcedMetadataError,
  ],
  [
    'a server-level tool asks for approval',
    server({ apps: [app('desk', {})], tools: [tool('shared_refund', APPROVAL)] }),
    UnenforcedMetadataError,
  ],
  [
    'a server-level approval tool, and an approval gate only on an unrelated app',
    server({ apps: [app('desk', { plugins: [OwnAppApprovalPlugin] })], tools: [tool('shared_refund', APPROVAL)] }),
    UnenforcedMetadataError,
  ],
  [
    'a server-level plugin contributes an approval tool, and an approval gate only on an unrelated app',
    server({ apps: [app('desk', { plugins: [OwnAppApprovalPlugin] })], plugins: [QueueToolsPlugin] }),
    UnenforcedMetadataError,
  ],
  [
    'a server-level resource template declares authorities',
    server({ apps: [app('desk', {})], resources: [TicketTemplate] }),
    AuthConfigurationError,
  ],
  [
    'an entry names an authorities profile the authorities option does not define',
    server({ apps: [app('desk', { agents: [RefundsAgent] })], authorities: { profiles: { auditor: AUDITOR } } }),
    AuthConfigurationError,
  ],
  [
    'an authorities profile checks nothing',
    server({ apps: [app('desk', { agents: [RefundsAgent] })], authorities: { profiles: { admin: {} } } }),
    AuthConfigurationError,
  ],
  [
    'an agent declares authorities',
    server({ apps: [app('desk', { agents: [RefundsAgent] })] }),
    AuthConfigurationError,
  ],
  [
    'an approval tool offered only to agents',
    server({
      apps: [app('billing', { tools: [tool('agent_refund', { ...APPROVAL, availableWhen: { surface: ['agent'] } })] })],
    }),
    UnenforcedMetadataError,
  ],
  [
    'an approval tool on an app, and only another app has a plugin, which gates only that other app',
    server({
      apps: [
        app('billing', { tools: [tool('refund_invoice', APPROVAL)] }),
        app('desk', { plugins: [OwnAppApprovalPlugin] }),
      ],
    }),
    UnenforcedMetadataError,
  ],
  [
    'an approval tool on an app, and only a gate for its own app nested in a plugin value on another app',
    server({
      apps: [
        app('billing', { tools: [tool('refund_invoice', APPROVAL)] }),
        app('desk', { plugins: [wrappedGate(OwnAppApprovalPlugin)] }),
      ],
    }),
    UnenforcedMetadataError,
  ],
  [
    'an approval tool on an app, and the only plugin declaring approval has no hook',
    server({
      apps: [app('billing', { tools: [tool('refund_invoice', APPROVAL)], plugins: [HooklessApprovalPlugin] })],
    }),
    UnenforcedMetadataError,
  ],
  [
    'an approval tool inside an agent, and only its app has a plugin that enforces approval',
    server({ apps: [app('desk', { plugins: [AnyAppApprovalPlugin], agents: [refundDeskAgent()] })] }),
    UnenforcedMetadataError,
  ],
  [
    'an approval tool inside an agent whose own plugin enforces approval, but the agent skips the tool flow',
    server({
      apps: [
        app('desk', {
          agents: [refundDeskAgent({ plugins: [AnyAppApprovalPlugin], execution: { useToolFlow: false } })],
        }),
      ],
    }),
    UnenforcedMetadataError,
  ],
  [
    'an approval tool inside an agent that inherits plugins, and only another app gates its own tools',
    server({
      apps: [
        app('desk', { agents: [refundDeskAgent({ execution: { inheritPlugins: true } })] }),
        app('ops', { plugins: [OwnAppApprovalPlugin] }),
      ],
    }),
    UnenforcedMetadataError,
  ],
  [
    'an approval tool inside an agent that inherits the plugins of its app, but skips the tool flow',
    server({
      apps: [
        app('desk', {
          plugins: [OwnAppApprovalPlugin],
          agents: [refundDeskAgent({ execution: { inheritPlugins: true, useToolFlow: false } })],
        }),
      ],
    }),
    UnenforcedMetadataError,
  ],
  [
    'an approval tool on an app, and only an agent has a plugin that enforces approval',
    server({ apps: [app('desk', { tools: [tool('refund_invoice', APPROVAL)], agents: [approvingTriageAgent()] })] }),
    UnenforcedMetadataError,
  ],
  [
    'an agent asks for approval, and only its own plugin enforces approval',
    server({ apps: [app('desk', { agents: [approvingTriageAgent(APPROVAL)] })] }),
    UnenforcedMetadataError,
  ],
];

function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

function errorOf(fn: () => void): unknown {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('assertStaticStartupConfig', () => {
  it.each(ACCEPTED)('accepts a server the full checks accept: %s', async (_c, config) => {
    const full = await rejectionOf(FrontMcpInstance.createDirect(config).then((direct) => direct.dispose()));

    expect(full).toBeUndefined();
    expect(errorOf(() => assertStaticStartupConfig(config))).toBeUndefined();
  });

  it.each(REFUSED)('refuses what the full checks refuse when %s', async (_c, config, E) => {
    const full = await rejectionOf(FrontMcpInstance.createDirect(config));
    const fast = errorOf(() => assertStaticStartupConfig(config));

    expect(full).toBeInstanceOf(E);
    expect(fast).toBeInstanceOf(E);
  });

  it('reads the hooks of a plugin compiled with TC39 decorators without taking them from the build', () => {
    @Plugin({ name: 'tc39-own-app-approval', enforcesMetadata: ['approval'] })
    class Tc39OwnAppApprovalPlugin {
      gate() {
        // enforcement itself is not under test here
      }
    }
    const pendingHook: HookMetadata = {
      type: 'will',
      flow: 'tools:call-tool',
      stage: 'execute',
      target: null,
      method: 'gate',
    };
    registerPendingTC39Hook(Tc39OwnAppApprovalPlugin.prototype.gate, pendingHook);
    const config = server({
      apps: [
        app('billing', { tools: [tool('refund_invoice', APPROVAL)] }),
        app('desk', { plugins: [Tc39OwnAppApprovalPlugin] }),
      ],
    });

    expect(errorOf(() => assertStaticStartupConfig(config))).toBeInstanceOf(UnenforcedMetadataError);
    expect(resolvePendingTC39HooksForClass(Tc39OwnAppApprovalPlugin)).toEqual([pendingHook]);
  });
});
