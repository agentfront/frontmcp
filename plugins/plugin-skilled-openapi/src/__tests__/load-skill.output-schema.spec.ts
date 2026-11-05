/**
 * `load_skill` describes a loaded skill once in `tools/list` (#1126): `skill` and `skills[].skill` refer to one
 * `$defs` entry, and its answers for `skillId` and `skillIds` validate against that schema with the MCP client's
 * own validator, also when elicitation wraps the schema in `oneOf`.
 */
import 'reflect-metadata';

import { compileSkilledBundleFromOpenApi } from '@frontmcp/adapters/skills';
import { AjvJsonSchemaValidator } from '@frontmcp/protocol';
import { Client } from '@frontmcp/protocol/client';
import { createInMemoryServer, FrontMcpInstance, LogLevel } from '@frontmcp/sdk';

import { SkilledOpenApiPlugin } from '../index';

const OUTPUT_SCHEMA_BYTES_WITH_THE_SKILL_TWICE = 2_118;
const OUTPUT_SCHEMA_BYTE_BUDGET = 1_337;
const LOADED_SKILL_REF = { $ref: '#/$defs/LoadedSkill' };

const operation = (operationId: string, summary: string) => ({
  get: { operationId, summary, responses: { 200: { description: 'OK' } } },
});

async function connectToShop(serverOptions: Record<string, unknown>) {
  const spec = {
    openapi: '3.0.3',
    info: { title: 'Pet shop', version: '1.0.0' },
    paths: { '/pets': operation('findPets', 'Finds pets.'), '/store/inventory': operation('getInventory', 'Counts.') },
  };
  const bundle = await compileSkilledBundleFromOpenApi(
    spec,
    [
      {
        id: 'pet-catalog',
        name: 'Pet catalog',
        description: 'Find pets.',
        instructions: '# Pets',
        operationIds: ['findPets'],
      },
      {
        id: 'store',
        name: 'Store',
        description: 'Count pets.',
        instructions: '# Store',
        operationIds: ['getInventory'],
      },
    ],
    { bundleId: 'shop', version: '1.0.0', baseUrl: 'https://shop.example' },
  );
  const instance = await FrontMcpInstance.createForGraph({
    info: { name: 'shop', version: '1.0.0' },
    apps: [],
    plugins: [SkilledOpenApiPlugin.init({ source: { type: 'inline', content: bundle }, requireSignature: false })],
    logging: { level: LogLevel.Off },
    ...serverOptions,
  } as never);
  const scope = instance.getPrimaryScope();
  if (!scope) throw new Error('the server config produced no scope');
  const { clientTransport, close } = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
  const client = new Client({ name: 'load-skill-output-schema', version: '1.0.0' });
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  const outputSchema = tools.find((tool) => tool.name === 'load_skill')?.outputSchema;
  if (!outputSchema) throw new Error('tools/list lists no outputSchema for load_skill');
  return {
    client,
    outputSchema: outputSchema as Record<string, unknown>,
    close: async () => {
      await client.close();
      await close();
    },
  };
}

describe('load_skill outputSchema in tools/list (#1126)', () => {
  let connection: Awaited<ReturnType<typeof connectToShop>>;

  beforeAll(async () => {
    connection = await connectToShop({});
  });

  afterAll(async () => {
    await connection?.close();
  });

  it('describes a loaded skill once and refers to it from skill and skills[].skill', () => {
    const { outputSchema } = connection;
    const properties = outputSchema['properties'] as Record<string, Record<string, unknown>>;
    const skillsItem = properties['skills']['items'] as { properties: Record<string, unknown> };

    expect(properties['skill']).toEqual(LOADED_SKILL_REF);
    expect(skillsItem.properties['skill']).toEqual(LOADED_SKILL_REF);
    expect(Object.keys(outputSchema['$defs'] as object)).toEqual(['LoadedSkill']);
    expect(JSON.stringify(outputSchema).match(/"actionId":/g)).toHaveLength(1);
  });

  it('is smaller than the schema that wrote the skill out twice', () => {
    const bytes = JSON.stringify(connection.outputSchema).length;

    expect(bytes).toBeLessThan(OUTPUT_SCHEMA_BYTES_WITH_THE_SKILL_TWICE);
    expect(bytes).toBeLessThanOrEqual(OUTPUT_SCHEMA_BYTE_BUDGET);
  });
});

describe.each([
  ['without elicitation', {}],
  ['with elicitation, which wraps the schema in oneOf', { elicitation: { enabled: true } }],
])('load_skill answers validate against the listed outputSchema %s (#1126)', (_label, serverOptions) => {
  let connection: Awaited<ReturnType<typeof connectToShop>>;
  let validate: ReturnType<AjvJsonSchemaValidator['getValidator']>;

  beforeAll(async () => {
    connection = await connectToShop(serverOptions);
    validate = new AjvJsonSchemaValidator().getValidator(connection.outputSchema);
  });

  afterAll(async () => {
    await connection?.close();
  });

  it('validates the answer for skillId', async () => {
    const result = await connection.client.callTool({ name: 'load_skill', arguments: { skillId: 'store' } });

    expect(result.structuredContent).toMatchObject({ skill: { id: 'store' }, isComplete: true });
    expect(validate(result.structuredContent)).toMatchObject({ valid: true });
  });

  it('validates the answer for skillIds', async () => {
    const result = await connection.client.callTool({
      name: 'load_skill',
      arguments: { skillIds: ['store', 'pet-catalog'] },
    });

    expect(result.structuredContent).toMatchObject({
      skills: [{ skill: { id: 'store' } }, { skill: { id: 'pet-catalog' } }],
    });
    expect(validate(result.structuredContent)).toMatchObject({ valid: true });
  });

  it('refuses a skill under skills[] that the referenced definition does not allow', () => {
    const skillWithoutInstructions = { id: 'store', name: 'Store', description: 'Count pets.' };

    expect(validate({ skills: [{ skill: skillWithoutInstructions, isComplete: true }] })).toMatchObject({
      valid: false,
    });
  });
});
