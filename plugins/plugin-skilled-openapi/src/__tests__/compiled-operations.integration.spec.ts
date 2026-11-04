/**
 * Running operations `compileSkilledBundleFromOpenApi` built from an OpenAPI spec, through a real FrontMCP server.
 *
 * Up to 1.11.0:
 *   - a 2xx response documented by a description only compiled to the output schema `{ "type": "null" }`, so
 *     every JSON answer failed with `upstream response failed output schema: <root>: Invalid input: expected
 *     null, received object`;
 *   - an array query parameter was sent comma-joined (`ids=1%2C2`), even with `style: form` and `explode: true`,
 *     where OpenAPI sends `ids=1&ids=2`.
 */
import 'reflect-metadata';

import { compileSkilledBundleFromOpenApi } from '@frontmcp/adapters/skills';
import { FrontMcpInstance, LogLevel, type DirectMcpServer } from '@frontmcp/sdk';

import { SkilledOpenApiPlugin } from '../index';

const SERVICE_URL = 'https://203.0.113.10/v1';

const ACCOUNT_PLAN = { plan: 'growth', seats: 5 };

const arrayQueryParameter = (name: string, style: string, explode: boolean) => ({
  name,
  in: 'query',
  required: true,
  style,
  explode,
  schema: { type: 'array', items: { type: 'string' } },
});

const listResponse = {
  '200': { description: 'The invoices', content: { 'application/json': { schema: { type: 'object' } } } },
};

const spec = {
  openapi: '3.0.3',
  info: { title: 'Billing', version: '1.0.0' },
  servers: [{ url: SERVICE_URL }],
  paths: {
    '/account/plan': {
      get: { operationId: 'getAccountPlan', responses: { '200': { description: 'The account plan' } } },
    },
    '/invoices': {
      get: {
        operationId: 'listInvoices',
        parameters: [arrayQueryParameter('ids', 'form', true)],
        responses: listResponse,
      },
    },
    '/invoices/by-tag': {
      get: {
        operationId: 'listInvoicesByTag',
        parameters: [arrayQueryParameter('tags', 'pipeDelimited', false)],
        responses: listResponse,
      },
    },
  },
};

const sentUrls: string[] = [];
const originalFetch = global.fetch;
let server: DirectMcpServer;

beforeAll(async () => {
  global.fetch = jest.fn(async (url: string | URL | Request) => {
    sentUrls.push(String(url));
    const body = String(url).includes('/account/plan') ? ACCOUNT_PLAN : { invoices: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

  const bundle = await compileSkilledBundleFromOpenApi(
    spec,
    [
      {
        id: 'billing',
        name: 'Billing',
        description: 'Read the account plan and list invoices.',
        instructions: '# Billing',
        operationIds: ['getAccountPlan', 'listInvoices', 'listInvoicesByTag'],
      },
    ],
    { bundleId: 'acme:billing', version: '1.0.0' },
  );
  server = await FrontMcpInstance.createDirect({
    info: { name: 'billing', version: '1.0.0' },
    apps: [],
    plugins: [SkilledOpenApiPlugin.init({ source: { type: 'inline', content: bundle }, dev: true })],
    logging: { level: LogLevel.Off },
  });
  await server.listTools();
});

afterAll(async () => {
  global.fetch = originalFetch;
  await server?.dispose();
});

beforeEach(() => {
  sentUrls.length = 0;
});

async function runWorkflow(script: string) {
  const result = await server.callTool('run_workflow', { script });
  return result.structuredContent as { success: boolean; error?: string; value?: unknown };
}

describe('an operation compiled from a response documented by a description only', () => {
  it('returns the JSON answer', async () => {
    const result = await runWorkflow('return await callTool("getAccountPlan", {})');

    expect(result).toEqual(expect.objectContaining({ success: true, value: ACCOUNT_PLAN }));
  });
});

describe('an array query parameter compiled from the spec', () => {
  it('repeats its key with style: form and explode: true', async () => {
    const result = await runWorkflow('return await callTool("listInvoices", { ids: ["1", "2"] })');

    expect(result).toMatchObject({ success: true });
    expect(sentUrls).toEqual([`${SERVICE_URL}/invoices?ids=1&ids=2`]);
  });

  it('joins its items by the style delimiter when explode is false', async () => {
    const result = await runWorkflow('return await callTool("listInvoicesByTag", { tags: ["late", "eu"] })');

    expect(result).toMatchObject({ success: true });
    expect(sentUrls).toEqual([`${SERVICE_URL}/invoices/by-tag?tags=late%7Ceu`]);
  });
});
