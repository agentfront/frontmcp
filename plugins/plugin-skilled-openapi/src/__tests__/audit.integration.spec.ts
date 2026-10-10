/** `skillsConfig.audit` on a real server with the plugin installed, without `setSkillAuditFactory()`. */
import 'reflect-metadata';

import {
  defaultAuditSignatureVerifier,
  Hs256AuditSigner,
  MemoryAuditStore,
  verifyChain,
  type SkillAuditRecord,
} from '@frontmcp/adapters/skills';
import { FrontMcpInstance, LogLevel, type DirectAuthContext, type DirectMcpServer } from '@frontmcp/sdk';

import { SkilledOpenApiPlugin } from '../index';

const SIGNING_SECRET = 'audit-integration-signing-secret';
const KEY_ID = 'audit-integration';

const bundle = {
  schemaVersion: 1,
  bundleId: 'acme:billing',
  version: '1.0.0',
  generatedAt: '2026-09-01T12:00:00.000Z',
  sourceDigest: '0'.repeat(64),
  services: [{ id: 'billing', baseUrl: 'https://203.0.113.10/v1' }],
  authBindings: { vault: { kind: 'bearer', vaultRef: 'billing-token' } },
  skills: [
    {
      id: 'invoices',
      name: 'Invoices',
      description: 'Look up invoices.',
      instructions: '# Invoices',
      operationIds: ['getInvoice'],
    },
  ],
  operations: {
    getInvoice: {
      operationId: 'getInvoice',
      serviceId: 'billing',
      httpMethod: 'GET',
      pathTemplate: '/invoices/{id}',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      outputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      mapper: [{ inputKey: 'id', type: 'path', key: 'id', required: true }],
      authBindingRef: 'vault',
    },
  },
};

const CALLER: DirectAuthContext = { sessionId: 'caller', token: 'caller-token', user: { sub: 'caller' } };
const originalFetch = global.fetch;
const store = new MemoryAuditStore();
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

beforeAll(async () => {
  global.fetch = (async () =>
    new Response(JSON.stringify({ id: 'inv_1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

  server = await FrontMcpInstance.createDirect({
    info: { name: 'billing', version: '1.0.0' },
    apps: [],
    plugins: [
      SkilledOpenApiPlugin.init({
        source: { type: 'inline', content: bundle },
        dev: true,
        credentials: { 'billing-token': 'vault-secret' },
      }),
    ],
    skillsConfig: {
      enabled: true,
      audit: { enabled: true, signer: new Hs256AuditSigner(SIGNING_SECRET, KEY_ID), store },
    },
    logging: { level: LogLevel.Off },
  } as never);
  await server.listTools({ authContext: CALLER });
});

afterAll(async () => {
  global.fetch = originalFetch;
  await server?.dispose();
});

describe('skillsConfig.audit with the plugin installed', () => {
  it('records each action, a failed input included, as a verifiable chain with hashed subjects', async () => {
    await server.callTool(
      'run_workflow',
      { script: 'return await callTool("getInvoice", { id: "inv_1" })' },
      { authContext: CALLER },
    );
    await server.callTool(
      'run_workflow',
      { script: 'return await callTool("getInvoice", {})' },
      { authContext: CALLER },
    );

    const records = await recordsAfter(4);

    expect(records.map((record) => record.phase)).toEqual([
      'authority-check-pass',
      'http-call-success',
      'authority-check-pass',
      'http-call-failure',
    ]);
    expect(records[3]?.errorMessage).toMatch(/^input validation failed/);
    expect(records.every((record) => /^hashed:[0-9a-f]{32}$/.test(record.subject))).toBe(true);
    expect(
      verifyChain(
        records,
        [{ keyId: KEY_ID, alg: 'HS256', secret: new TextEncoder().encode(SIGNING_SECRET) }],
        defaultAuditSignatureVerifier,
      ),
    ).toEqual({ ok: true, verified: 4 });
  });
});
