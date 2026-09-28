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
} from '../../common';
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

/** Contributes a tool that asks for approval, and enforces nothing. */
@Plugin({ name: 'queue-tools', tools: [tool('purge_queue', APPROVAL)] })
class QueueToolsPlugin {}

const llm = { adapter: { completion: async () => ({ content: 'done', finishReason: 'stop' as const }) } };

@Agent({ name: 'refunds', inputSchema: {}, llm, authorities: 'admin' })
class RefundsAgent extends AgentContext {}

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
    'an approval tool in the server-level tools list, which no scope registers',
    server({ apps: [app('desk', {})], tools: [tool('shared_refund', APPROVAL)] }),
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
});
