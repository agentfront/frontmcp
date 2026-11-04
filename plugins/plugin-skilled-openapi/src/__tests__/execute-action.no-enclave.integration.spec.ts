// Without the optional @enclave-vm sandbox, run_workflow answers that it is unavailable and execute_action still runs an action.
import 'reflect-metadata';

import { FrontMcpInstance, LogLevel, type CallToolResult, type DirectMcpServer } from '@frontmcp/sdk';

import { SkilledOpenApiPlugin } from '../index';

jest.mock('@enclave-vm/core/worker', () => {
  throw new Error("Cannot find module '@enclave-vm/core/worker'");
});

const INVOICE = { id: 'inv_1', status: 'paid' };

const bundle = {
  schemaVersion: 1,
  bundleId: 'acme:billing',
  version: '1.0.0',
  generatedAt: '2026-09-01T12:00:00.000Z',
  sourceDigest: '0'.repeat(64),
  services: [{ id: 'billing', baseUrl: 'https://203.0.113.10/v1' }],
  authBindings: { none: { kind: 'none' } },
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
      outputSchema: { type: 'object' },
      mapper: [{ inputKey: 'id', type: 'path', key: 'id', required: true }],
      authBindingRef: 'none',
    },
  },
};

const originalFetch = global.fetch;
let server: DirectMcpServer;

beforeAll(async () => {
  global.fetch = (async () =>
    new Response(JSON.stringify(INVOICE), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  server = await FrontMcpInstance.createDirect({
    info: { name: 'billing', version: '1.0.0' },
    apps: [],
    plugins: [SkilledOpenApiPlugin.init({ source: { type: 'inline', content: bundle }, requireSignature: false })],
    logging: { level: LogLevel.Off },
  } as never);
});

afterAll(async () => {
  global.fetch = originalFetch;
  await server?.dispose();
});

describe('a server without @enclave-vm/core', () => {
  it('answers run_workflow with an error that names the missing sandbox', async () => {
    const result = (await server.callTool('run_workflow', {
      script: "return await callTool('getInvoice', { id: 'inv_1' });",
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: false,
      error: expect.stringMatching(/^workflow execution unavailable: the @enclave-vm sandbox is not installed/),
    });
  });

  it('runs an action with execute_action', async () => {
    const result = (await server.callTool('execute_action', {
      actionId: 'getInvoice',
      input: { id: 'inv_1' },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(INVOICE);
  });
});
