/**
 * A workflow that ends while one of its requests is in flight aborts that request. A real server
 * and the real `@enclave-vm` interpreter, with its time limit shortened so the test runs quickly.
 */
import 'reflect-metadata';

import { Hs256AuditSigner, MemoryAuditStore, type SkillAuditRecord } from '@frontmcp/adapters/skills';
import { FrontMcpInstance, LogLevel, type DirectAuthContext, type DirectMcpServer } from '@frontmcp/sdk';

import { SkilledOpenApiPlugin } from '../index';

const mockWorkflowTimeLimitMs = 300;

jest.mock('@enclave-vm/core/worker', () => {
  const worker = jest.requireActual<typeof import('@enclave-vm/core/worker')>('@enclave-vm/core/worker');
  type ExecuteArgs = Parameters<InstanceType<typeof worker.InterpreterAdapter>['execute']>;
  class InterpreterAdapterWithShortTimeLimit extends worker.InterpreterAdapter {
    override execute(...[code, context]: ExecuteArgs) {
      return super.execute(code, { ...context, config: { ...context.config, timeout: mockWorkflowTimeLimitMs } });
    }
  }
  return { ...worker, InterpreterAdapter: InterpreterAdapterWithShortTimeLimit };
});

const SERVICE_URL = 'https://203.0.113.10/v1';

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
      description: 'Build billing reports.',
      instructions: '# Reports',
      operationIds: ['createReport', 'getLatestReport'],
    },
  ],
  operations: {
    createReport: {
      operationId: 'createReport',
      serviceId: 'billing',
      httpMethod: 'POST',
      pathTemplate: '/reports',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      mapper: [],
      authBindingRef: 'none',
    },
    getLatestReport: {
      operationId: 'getLatestReport',
      serviceId: 'billing',
      httpMethod: 'GET',
      pathTemplate: '/reports/latest',
      timeoutMs: 50,
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      mapper: [],
      authBindingRef: 'none',
    },
  },
};

const CALLER: DirectAuthContext = { sessionId: 'caller', token: 'caller-token', user: { sub: 'caller' } };
const originalFetch = global.fetch;
const store = new MemoryAuditStore();
const sentRequests: Array<{ url: string; signal: AbortSignal }> = [];
let server: DirectMcpServer;

async function recordsAfter(count: number): Promise<SkillAuditRecord[]> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const records = await store.read();
    if (records.length >= count) return records;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`expected ${count} audit records, got ${(await store.read()).length}`);
}

const runWorkflow = (script: string) => server.callTool('run_workflow', { script }, { authContext: CALLER });

beforeAll(async () => {
  global.fetch = ((input: string | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) throw new Error('the request was sent without a signal');
      sentRequests.push({ url: String(input), signal });
      signal.addEventListener('abort', () => reject(signal.reason));
    })) as typeof fetch;

  server = await FrontMcpInstance.createDirect({
    info: { name: 'billing', version: '1.0.0' },
    apps: [],
    plugins: [SkilledOpenApiPlugin.init({ source: { type: 'inline', content: bundle }, dev: true })],
    skillsConfig: {
      enabled: true,
      audit: { enabled: true, signer: new Hs256AuditSigner('workflow-abort-signing-secret', 'workflow-abort'), store },
    },
    logging: { level: LogLevel.Off },
  } as never);
});

beforeEach(() => {
  sentRequests.length = 0;
});

afterAll(async () => {
  global.fetch = originalFetch;
  await server?.dispose();
});

describe('run_workflow and the requests of a workflow that ends', () => {
  it('aborts the request in flight when the workflow times out, and audits it as a failure', async () => {
    const result = await runWorkflow('return await callTool("createReport", {})');

    expect(result.structuredContent).toMatchObject({
      success: false,
      error: `Execution timed out after ${mockWorkflowTimeLimitMs}ms`,
    });
    expect(sentRequests.map((request) => request.url)).toEqual([`${SERVICE_URL}/reports`]);
    expect(sentRequests[0]?.signal.aborted).toBe(true);

    const records = await recordsAfter(2);
    expect(records.map((record) => record.phase)).toEqual(['authority-check-pass', 'http-call-failure']);
    expect(records[1]?.errorMessage).toBe('request aborted: the workflow ended before the request finished');
  });

  it("still ends a request at the operation's own timeout", async () => {
    const result = await runWorkflow('return await callTool("getLatestReport", {})');

    expect(result.structuredContent).toMatchObject({ success: false, error: 'timeout after 50ms' });
    expect(sentRequests[0]?.signal.aborted).toBe(true);
  });
});
