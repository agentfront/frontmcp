// A web page's FrontMCP server, built with the SDK's browser create(), serving an inline Skilled OpenAPI bundle
import 'reflect-metadata';

import { SkilledOpenApiPlugin } from '@frontmcp/plugin-skilled-openapi';
import { create, LogLevel } from '@frontmcp/sdk';

const bundle = {
  schemaVersion: 1,
  bundleId: 'acme:billing',
  version: '1.0.0',
  generatedAt: '2026-11-04T12:00:00.000Z',
  sourceDigest: '0'.repeat(64),
  services: [{ id: 'billing', baseUrl: 'https://billing.example/v1' }],
  authBindings: { default: { kind: 'bearer', vaultRef: 'billing-token' } },
  skills: [
    {
      id: 'invoices',
      name: 'Invoices',
      description: 'Look up customer invoices.',
      instructions: '# Invoices\nUse getInvoice to read an invoice by its id.',
      operationIds: ['getInvoice'],
    },
  ],
  operations: {
    getInvoice: {
      operationId: 'getInvoice',
      serviceId: 'billing',
      httpMethod: 'GET',
      pathTemplate: '/invoices/{id}',
      public: true,
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      outputSchema: { type: 'object', properties: { id: { type: 'string' }, total: { type: 'number' } } },
      mapper: [{ inputKey: 'id', type: 'path', key: 'id', required: true }],
      authBindingRef: 'default',
    },
  },
};

const server = create({
  info: { name: 'billing-in-a-page', version: '1.0.0' },
  logging: { level: LogLevel.Off },
  plugins: [
    SkilledOpenApiPlugin.init({
      source: { type: 'inline', content: bundle },
      requireSignature: false,
      credentials: { 'billing-token': 'page-token' },
    }),
  ],
});

globalThis.callSkilledTool = async (name, args) => (await server).callTool(name, args);
