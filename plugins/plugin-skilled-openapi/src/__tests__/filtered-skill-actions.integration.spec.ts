/**
 * A skill a `skills:filter` hook hides from a caller, through a real server: discovery doesn't show it, and none of
 * the paths that run an action (run_workflow's callTool, execute_action, the operation tools server code calls) runs
 * an action only that skill lists. An action another listing skill shows the caller still runs.
 */
import 'reflect-metadata';

import { Hs256AuditSigner, MemoryAuditStore, type SkillAuditRecord } from '@frontmcp/adapters/skills';
import {
  App,
  DynamicPlugin,
  FlowHooksOf,
  FrontMcpContextStorage,
  FrontMcpInstance,
  LogLevel,
  Plugin,
  Tool,
  ToolContext,
  z,
  type CallToolResult,
  type DirectAuthContext,
  type DirectMcpServer,
  type FlowCtxOf,
} from '@frontmcp/sdk';

import { unknownActionError } from '../executor/action-outcome';
import { SkilledOpenApiPlugin } from '../index';

const SERVICE_URL = 'https://203.0.113.10/v1';

const operation = (operationId: string, pathTemplate: string) => ({
  operationId,
  serviceId: 'billing',
  httpMethod: 'GET',
  pathTemplate,
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  outputSchema: { type: 'object' },
  mapper: [{ inputKey: 'id', type: 'path', key: 'id', required: true }],
  authBindingRef: 'none',
  summary: `${operationId} summary`,
});

const bundle = {
  schemaVersion: 1,
  bundleId: 'acme:billing',
  version: '1.0.0',
  generatedAt: '2026-09-01T12:00:00.000Z',
  sourceDigest: '0'.repeat(64),
  services: [{ id: 'billing', baseUrl: SERVICE_URL }],
  authBindings: { none: { kind: 'none' } },
  skills: [
    {
      id: 'reports',
      name: 'Reports',
      description: 'Invoices and revenue reports.',
      instructions: '# Reports',
      operationIds: ['getInvoice', 'getRevenueReport'],
      tags: ['pro'],
    },
    {
      id: 'invoices',
      name: 'Invoices',
      description: 'Look up invoices.',
      instructions: '# Invoices',
      operationIds: ['getInvoice'],
    },
  ],
  operations: {
    getInvoice: operation('getInvoice', '/invoices/{id}'),
    getRevenueReport: operation('getRevenueReport', '/reports/{id}'),
  },
};

const FilterSkillsHook = FlowHooksOf('skills:filter');

/** Hides the skills tagged `pro` from a caller on the free plan, as a plan or feature-flag check does. */
@Plugin({ name: 'plan-gate' })
class PlanGatePlugin extends DynamicPlugin<Record<string, never>> {
  @FilterSkillsHook.Did('filterSkills')
  hideProSkillsFromFreePlan(flowCtx: FlowCtxOf<'skills:filter'>) {
    const user = this.get(FrontMcpContextStorage).getStore()?.authInfo?.user as { plan?: string } | undefined;
    if (user?.plan !== 'free') return;
    const skills = flowCtx.state.required.skills;
    flowCtx.state.set(
      'skills',
      skills.filter((skill) => !skill.metadata.tags?.includes('pro')),
    );
  }
}

@Tool({
  name: 'call_operation',
  inputSchema: { operationId: z.string() },
  outputSchema: { ok: z.boolean(), error: z.string().optional() },
})
class CallOperationTool extends ToolContext {
  async execute({ operationId }: { operationId: string }) {
    const answer = await this.callTool(`acme:billing.${operationId}`, { id: 'inv_1' });
    return answer.structuredContent as { ok: boolean; error?: string };
  }
}

@App({ name: 'host', tools: [CallOperationTool] })
class HostApp {}

const FREE_PLAN: DirectAuthContext = { sessionId: 'fiona', user: { sub: 'fiona', plan: 'free' } };
const PRO_PLAN: DirectAuthContext = { sessionId: 'paul', user: { sub: 'paul', plan: 'pro' } };

const originalFetch = global.fetch;
const sent: string[] = [];
const servers: DirectMcpServer[] = [];

async function startServer(
  options: { exposeOperationsAsInternalTools?: boolean } = {},
  auditStore = new MemoryAuditStore(),
): Promise<DirectMcpServer> {
  const started = await FrontMcpInstance.createDirect({
    info: { name: 'billing', version: '1.0.0' },
    apps: [HostApp],
    plugins: [
      PlanGatePlugin,
      SkilledOpenApiPlugin.init({
        source: { type: 'inline', content: bundle },
        requireSignature: false,
        ...options,
      }),
    ],
    skillsConfig: {
      enabled: true,
      audit: {
        enabled: true,
        signer: new Hs256AuditSigner('filtered-skill-actions-secret', 'filtered-skill-actions'),
        store: auditStore,
      },
    },
    logging: { level: LogLevel.Off },
  } as never);
  servers.push(started);
  await started.listTools({ authContext: PRO_PLAN });
  return started;
}

let server: DirectMcpServer;
let serverWithoutOperationTools: DirectMcpServer;

beforeAll(async () => {
  global.fetch = (async (input: string | URL) => {
    sent.push(new URL(String(input)).pathname);
    return new Response(JSON.stringify({ id: 'inv_1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  server = await startServer();
  serverWithoutOperationTools = await startServer({ exposeOperationsAsInternalTools: false });
});

afterAll(async () => {
  global.fetch = originalFetch;
  await Promise.all(servers.map((started) => started.dispose()));
});

beforeEach(() => {
  sent.length = 0;
});

interface ActionAnswer {
  ok: boolean;
  error?: string;
}

function textOf(result: CallToolResult): string {
  return result.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

async function runWorkflow(target: DirectMcpServer, caller: DirectAuthContext, actionId: string) {
  const script = `return await callTool('${actionId}', { id: 'inv_1' });`;
  const result = await target.callTool('run_workflow', { script }, { authContext: caller });
  const output = result.structuredContent as { success: boolean; error?: string };
  return { ok: output.success, ...(output.error ? { error: output.error } : {}) };
}

async function executeAction(target: DirectMcpServer, caller: DirectAuthContext, actionId: string) {
  const result = await target.callTool('execute_action', { actionId, input: { id: 'inv_1' } }, { authContext: caller });
  return result.isError === true ? { ok: false, error: textOf(result) } : { ok: true };
}

async function callOperationTool(target: DirectMcpServer, caller: DirectAuthContext, operationId: string) {
  const result = await target.callTool('call_operation', { operationId }, { authContext: caller });
  return result.structuredContent as unknown as ActionAnswer;
}

const PATHS: Array<[string, (caller: DirectAuthContext, actionId: string) => Promise<ActionAnswer>]> = [
  ["run_workflow's callTool", (caller, actionId) => runWorkflow(server, caller, actionId)],
  ['execute_action, through the operation tool', (caller, actionId) => executeAction(server, caller, actionId)],
  [
    'execute_action, without operation tools',
    (caller, actionId) => executeAction(serverWithoutOperationTools, caller, actionId),
  ],
  ['an operation tool server code calls', (caller, actionId) => callOperationTool(server, caller, actionId)],
];

async function loadedSkillIds(caller: DirectAuthContext): Promise<string[]> {
  const loaded: string[] = [];
  for (const skillId of ['reports', 'invoices']) {
    const result = await server
      .callTool('load_skill', { skillId }, { authContext: caller })
      .catch((): undefined => undefined);
    if (result && result.isError !== true) loaded.push(skillId);
  }
  return loaded;
}

async function auditRecords(auditStore: MemoryAuditStore, count: number): Promise<SkillAuditRecord[]> {
  const deadline = Date.now() + 5_000;
  let records: SkillAuditRecord[] = [];
  while (Date.now() < deadline) {
    records = await auditStore.read();
    if (records.length >= count) return records;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`expected ${count} audit records, got ${records.length}`);
}

describe('a skill a skills:filter hook hides from the caller', () => {
  it('is not loaded for that caller, and is for another', async () => {
    expect(await loadedSkillIds(FREE_PLAN)).toEqual(['invoices']);
    expect(await loadedSkillIds(PRO_PLAN)).toEqual(['reports', 'invoices']);
  });

  describe.each(PATHS)('through %s', (_path, callAction) => {
    it('runs an action another listing skill shows the caller, though the hidden skill lists it first', async () => {
      expect(await callAction(FREE_PLAN, 'getInvoice')).toEqual({ ok: true });
      expect(sent).toEqual(['/v1/invoices/inv_1']);
    });

    it('answers an action only the hidden skill lists as an unknown action, sending nothing', async () => {
      expect(await callAction(FREE_PLAN, 'getRevenueReport')).toEqual({
        ok: false,
        error: unknownActionError('getRevenueReport'),
      });
      expect(sent).toEqual([]);
    });

    it('runs that action for a caller the hook shows the skill to', async () => {
      expect(await callAction(PRO_PLAN, 'getRevenueReport')).toEqual({ ok: true });
      expect(sent).toEqual(['/v1/reports/inv_1']);
    });
  });

  it('records the refused call in the audit log as a failed authority check', async () => {
    const auditStore = new MemoryAuditStore();
    const audited = await startServer({}, auditStore);

    await executeAction(audited, FREE_PLAN, 'getRevenueReport');

    const [record] = await auditRecords(auditStore, 1);
    expect(record).toMatchObject({
      phase: 'authority-check-fail',
      skillId: 'reports',
      actionId: 'getRevenueReport',
      errorMessage: 'skills:filter hides every skill that lists the action',
    });
  });
});
