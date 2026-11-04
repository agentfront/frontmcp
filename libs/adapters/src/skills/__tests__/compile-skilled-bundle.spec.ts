/**
 * The operations `compileSkilledBundleFromOpenApi` builds from an OpenAPI spec.
 *
 * Up to 1.11.0 a 2xx response documented by a description only (no `content`) compiled to the output
 * schema `{ "type": "null" }`, so every JSON answer failed with `expected null, received object`.
 */
import { z } from '@frontmcp/lazy-zod';

import { crossValidate, resolvedBundleSchema } from '../bundle/bundle.schema';
import { compileSkilledBundleFromOpenApi, type SkillOpenApiRef } from '../openapi/compile-skilled-bundle';

const JSON_ANSWER = { plan: 'growth', seats: 5 };

const invoiceSchema = {
  type: 'object',
  properties: { id: { type: 'string' }, status: { type: 'string' }, amount: { type: 'number' } },
  required: ['id', 'status', 'amount'],
};

const errorContent = {
  'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } },
};

const billingSpec = {
  openapi: '3.0.3',
  info: { title: 'Billing', version: '1.0.0' },
  servers: [{ url: 'https://billing.example.com' }],
  paths: {
    '/v1/invoices': {
      get: {
        operationId: 'listInvoices',
        summary: 'List the invoices with the given ids',
        parameters: [
          {
            name: 'ids',
            in: 'query',
            required: true,
            style: 'form',
            explode: true,
            schema: { type: 'array', items: { type: 'string' } },
          },
        ],
        responses: {
          '200': {
            description: 'The invoices',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { invoices: { type: 'array', items: invoiceSchema } },
                  required: ['invoices'],
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createInvoice',
        responses: { '201': { description: 'Created' }, '400': { description: 'Invalid', content: errorContent } },
      },
    },
    '/v1/invoices/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      head: { operationId: 'invoiceExists', responses: { '200': { description: 'The invoice exists' } } },
      delete: { operationId: 'voidInvoice', responses: { '204': { description: 'Voided' } } },
      put: { operationId: 'resetInvoice', responses: { '205': { description: 'Reset' } } },
      patch: {
        operationId: 'patchInvoice',
        responses: { '200': { description: 'Patched', content: { 'application/json': {} } } },
      },
    },
    '/v1/account/plan': {
      get: {
        operationId: 'getAccountPlan',
        summary: 'Read the plan the account is on',
        responses: { '200': { description: 'The account plan' } },
      },
    },
    '/v1/account/limits': {
      get: { operationId: 'getAccountLimits', responses: { default: { description: 'The account limits' } } },
    },
  },
};

function skillFor(operationIds: string[]): SkillOpenApiRef {
  return { id: 'billing', name: 'Billing', description: 'Billing', instructions: '# Billing', operationIds };
}

async function compileOperations(operationIds: string[]) {
  const bundle = await compileSkilledBundleFromOpenApi(billingSpec, [skillFor(operationIds)], {
    bundleId: 'e2e:billing',
    version: '1.0.0',
    serviceId: 'billing',
  });
  return bundle.operations;
}

async function outputSchemaOf(operationId: string): Promise<Record<string, unknown>> {
  const operations = await compileOperations([operationId]);
  return operations[operationId]?.outputSchema as Record<string, unknown>;
}

function accepts(jsonSchema: Record<string, unknown>, answer: unknown): boolean {
  return z.fromJSONSchema(jsonSchema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(answer).success;
}

describe('compileSkilledBundleFromOpenApi', () => {
  describe('the output schema of a response with no body schema', () => {
    it('accepts any answer to a 2xx documented by a description only', async () => {
      const outputSchema = await outputSchemaOf('getAccountPlan');

      expect(outputSchema).toEqual({ description: 'The account plan', 'x-status-code': 200 });
      expect(accepts(outputSchema, JSON_ANSWER)).toBe(true);
      expect(accepts(outputSchema, [JSON_ANSWER])).toBe(true);
    });

    it('accepts any answer to a default response documented by a description only', async () => {
      const outputSchema = await outputSchemaOf('getAccountLimits');

      expect(outputSchema).toEqual({ description: 'The account limits', 'x-status-code': 0 });
      expect(accepts(outputSchema, JSON_ANSWER)).toBe(true);
    });

    it('accepts any answer to a JSON response that names no schema', async () => {
      const outputSchema = await outputSchemaOf('patchInvoice');

      expect(outputSchema).toEqual({});
      expect(accepts(outputSchema, [JSON_ANSWER])).toBe(true);
    });

    it.each([
      ['a 204', 'voidInvoice', 'Voided', 204],
      ['a 205', 'resetInvoice', 'Reset', 205],
      ['a HEAD operation', 'invoiceExists', 'The invoice exists', 200],
    ])('stays bodyless for %s', async (_case, operationId, description, statusCode) => {
      expect(await outputSchemaOf(operationId)).toEqual({ type: 'null', description, 'x-status-code': statusCode });
    });

    it('makes the union of status codes an anyOf, so an answer may fit more than one', async () => {
      const outputSchema = await outputSchemaOf('createInvoice');

      expect(outputSchema).toEqual({
        description: 'Response can be one of multiple status codes',
        anyOf: [
          { description: 'Created', 'x-status-code': 201 },
          {
            ...errorContent['application/json'].schema,
            description: 'Invalid',
            'x-status-code': 400,
            'x-content-type': 'application/json',
          },
        ],
      });
      expect(accepts(outputSchema, { id: 'inv_1' })).toBe(true);
      expect(accepts(outputSchema, { error: 'looks like the 400 body too' })).toBe(true);
    });
  });

  it('records the style and explode of a query parameter in its mapper entry', async () => {
    const operations = await compileOperations(['listInvoices']);

    expect(operations['listInvoices']?.mapper).toEqual([
      { inputKey: 'ids', type: 'query', key: 'ids', required: true, style: 'form', explode: true },
    ]);
  });

  it('builds a bundle the strict bundle schema accepts', async () => {
    const bundle = await compileSkilledBundleFromOpenApi(billingSpec, [skillFor(['listInvoices', 'getAccountPlan'])], {
      bundleId: 'e2e:billing',
      version: '1.0.0',
    });
    const parsed = resolvedBundleSchema.parse(bundle);

    expect(crossValidate(parsed)).toEqual({ ok: true });
  });

  it('compiles listInvoices and getAccountPlan to the operations the skilled-openapi e2e fixture carries', async () => {
    const operations = await compileOperations(['listInvoices', 'getAccountPlan']);

    expect(operations).toEqual({
      listInvoices: {
        operationId: 'listInvoices',
        serviceId: 'billing',
        httpMethod: 'GET',
        pathTemplate: '/v1/invoices',
        summary: 'List the invoices with the given ids',
        inputSchema: {
          type: 'object',
          properties: {
            ids: {
              type: 'array',
              items: { type: 'string' },
              'x-parameter-location': 'query',
              'x-parameter-style': 'form',
              'x-parameter-explode': true,
            },
          },
          required: ['ids'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: { invoices: { type: 'array', items: invoiceSchema } },
          required: ['invoices'],
          'x-status-code': 200,
          description: 'The invoices',
          'x-content-type': 'application/json',
        },
        mapper: [{ inputKey: 'ids', type: 'query', key: 'ids', required: true, style: 'form', explode: true }],
        authBindingRef: 'default',
      },
      getAccountPlan: {
        operationId: 'getAccountPlan',
        serviceId: 'billing',
        httpMethod: 'GET',
        pathTemplate: '/v1/account/plan',
        summary: 'Read the plan the account is on',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: { description: 'The account plan', 'x-status-code': 200 },
        mapper: [],
        authBindingRef: 'default',
      },
    });
  });
});
