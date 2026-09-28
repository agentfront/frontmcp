/**
 * A server whose only skills come from a Skilled OpenAPI bundle serves the skills methods and the
 * skills capability from startup.
 *
 * In 1.8.3 the server decided once, while starting, whether it serves skills, from the skills
 * registered then. The bundle's skills are registered later, so a client that connected before the
 * bundle had loaded got `-32601 Method not found` for `skills/list` for as long as it stayed
 * connected, the SEP-2640 capability wasn't declared, and `skill://index.json` was never served.
 *
 * The host here turns off background loading (`disablePolling`, as `@frontmcp/edge` does), so the
 * bundle loads only when a meta-tool or `tools/list` asks for it: the client below connects, and
 * asks for skills, strictly before the bundle has loaded.
 */
import 'reflect-metadata';

import { Client } from '@frontmcp/protocol';
import { createInMemoryServer, FrontMcpInstance, LogLevel, z } from '@frontmcp/sdk';

import { SkilledOpenApiPlugin } from '../index';
import { SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN } from '../skilled-openapi.plugin';

const SEP_2640_EXTENSION_ID = 'io.modelcontextprotocol/skills';

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

const skillsListSchema = z.object({ skills: z.array(z.object({ id: z.string() }).passthrough()) }).passthrough();
const readResourceSchema = z
  .object({ contents: z.array(z.object({ uri: z.string(), text: z.string().optional() }).passthrough()) })
  .passthrough();

describe('Skilled OpenAPI: skills surfaces before the bundle has loaded', () => {
  let client: Client;
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    // Built the way `@frontmcp/edge` builds a Worker's server: the host's runtime deps turn off
    // background loading.
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
      logging: { level: LogLevel.Off },
    } as never);
    const scope = instance.getPrimaryScope();
    if (!scope) throw new Error('the server config produced no scope');
    const { clientTransport, close } = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
    client = new Client({ name: 'skills-before-load', version: '1.0.0' });
    await client.connect(clientTransport);
    closeServer = close;
  });

  afterAll(async () => {
    await client?.close();
    await closeServer?.();
  });

  const listSkillIds = async () =>
    (await client.request({ method: 'skills/list', params: {} }, skillsListSchema)).skills.map((skill) => skill.id);

  it('answers skills/list, empty until the bundle loads, then with its skills', async () => {
    expect(await listSkillIds()).toEqual([]);

    await client.listTools(); // loads the bundle, as a meta-tool call would
    expect(await listSkillIds()).toEqual(['invoices']);
  });

  it('declared the skills capability at initialize', () => {
    const capabilities = client.getServerCapabilities() as { experimental?: Record<string, unknown> } | undefined;
    expect(capabilities?.experimental?.[SEP_2640_EXTENSION_ID]).toBeDefined();
  });

  it('serves skill://index.json with the bundle skills', async () => {
    await client.listTools();
    const index = await client.request(
      { method: 'resources/read', params: { uri: 'skill://index.json' } },
      readResourceSchema,
    );
    expect(index.contents[0]?.text).toContain('invoices');
  });
});
