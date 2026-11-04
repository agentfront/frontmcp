/**
 * On a Skilled OpenAPI server the skill catalog points to `load_skill` and `search_skill`, which every client can
 * call, not to the `skill://index.json` resource; and the `initialize` instructions wait for the bundle, so they
 * count its skills (#1067).
 *
 * The host turns off background loading (`disablePolling`, as `@frontmcp/edge` does), so nothing but a request
 * loads the bundle: the first `initialize` runs strictly before anything else could have loaded it.
 */
import 'reflect-metadata';

import { Client } from '@frontmcp/protocol/client';
import { createInMemoryServer, FrontMcpInstance, LogLevel } from '@frontmcp/sdk';

import { SkilledOpenApiPlugin } from '../index';
import { SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN } from '../skilled-openapi.plugin';

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
      description: 'Look up customer invoices.',
      instructions: '# Invoices\nUse getInvoice.',
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

async function connectFirst(
  skillsConfig?: Record<string, unknown>,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const instance = await FrontMcpInstance.createForGraph({
    info: { name: 'billing', version: '1.0.0' },
    apps: [],
    plugins: [SkilledOpenApiPlugin.init({ source: { type: 'inline', content: bundle }, requireSignature: false })],
    providers: [
      {
        name: 'host:runtime-deps',
        provide: SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN,
        inject: () => [] as const,
        useFactory: () => ({ disablePolling: true }),
      },
    ],
    ...(skillsConfig ? { skillsConfig } : {}),
    logging: { level: LogLevel.Off },
  } as never);
  const scope = instance.getPrimaryScope();
  if (!scope) throw new Error('the server config produced no scope');
  const { clientTransport, close } = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
  const client = new Client({ name: 'catalog-pointers', version: '1.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await close();
    },
  };
}

describe('Skilled OpenAPI: where the skill catalog points (#1067)', () => {
  it("counts the bundle's skills in the first initialize, and names load_skill and search_skill", async () => {
    const { client, close } = await connectFirst();
    try {
      expect(client.getInstructions()).toBe(
        'This server has 1 skill: load one by name with `load_skill`, or find one with `search_skill`.',
      );
    } finally {
      await close();
    }
  });

  it('heads the catalog in the instructions with load_skill and search_skill', async () => {
    const { client, close } = await connectFirst({ enabled: true, injectInstructions: 'append' });
    try {
      expect(client.getInstructions()).toBe(
        'Available skills (load one by name with `load_skill`; `search_skill` finds others):\n\n' +
          '- **Invoices**: Look up customer invoices.',
      );
    } finally {
      await close();
    }
  });

  it("heads the catalog in search_skill's description the same way", async () => {
    const { client, close } = await connectFirst();
    try {
      const { tools } = await client.listTools();
      const description = tools.find((tool) => tool.name === 'search_skill')?.description ?? '';

      expect(description).toContain(
        'Available skills (load one by name with `load_skill`; `search_skill` finds others):\n\n' +
          '- **Invoices**: Look up customer invoices.',
      );
      expect(description).not.toContain('skill://index.json');
    } finally {
      await close();
    }
  });
});
