/**
 * `search_skill` and `load_skill` lead the model to the calls it needs (#1068): a skill the catalog names loads by
 * that name with no search first, several load in one call, and the descriptions say so, and that a loaded skill stays
 * in the model's context until its `bundleVersion` changes.
 */
import 'reflect-metadata';

import { compileSkilledBundleFromOpenApi } from '@frontmcp/adapters/skills';
import { FrontMcpInstance, LogLevel, type DirectMcpServer } from '@frontmcp/sdk';

import { SkilledOpenApiPlugin } from '../index';
import type { LoadSkillOutput } from '../tools/load-skill.schema';

const operation = (operationId: string, summary: string) => ({
  get: { operationId, summary, responses: { 200: { description: 'OK' } } },
});

let server: DirectMcpServer;

beforeAll(async () => {
  const spec = {
    openapi: '3.0.3',
    info: { title: 'Pet shop', version: '1.0.0' },
    paths: {
      '/pets': operation('findPets', 'Finds pets.'),
      '/store/inventory': operation('getInventory', 'Returns pet inventories by status.'),
    },
  };
  const bundle = await compileSkilledBundleFromOpenApi(
    spec,
    [
      {
        id: 'pet-catalog',
        name: 'Pet catalog',
        description: 'Find dogs, cats and birds.',
        instructions: '# Pet catalog',
        operationIds: ['findPets'],
      },
      {
        id: 'store',
        name: 'Store',
        description: 'Count the pets in stock, and read an order.',
        instructions: '# Store\n\nUse getInventory for the inventory.',
        operationIds: ['getInventory'],
      },
    ],
    { bundleId: 'shop', version: '1.0.0', baseUrl: 'https://shop.example' },
  );
  server = await FrontMcpInstance.createDirect({
    info: { name: 'shop', version: '1.0.0' },
    apps: [],
    logging: { level: LogLevel.Off },
    plugins: [SkilledOpenApiPlugin.init({ source: { type: 'inline', content: bundle }, requireSignature: false })],
  });
});

afterAll(async () => {
  await server?.dispose();
});

const load = async (args: Record<string, unknown>) =>
  (await server.callTool('load_skill', args)).structuredContent as unknown as LoadSkillOutput;

describe('load_skill (#1068)', () => {
  it('loads a skill by the name the catalog shows, with no search first', async () => {
    const { skill } = await load({ skillId: 'Store' });

    expect(skill?.id).toBe('store');
    expect(skill?.actions?.map((a) => a.actionId)).toEqual(['getInventory']);
    expect(skill?.bundleVersion).toBe('1.0.0');
  });

  it('loads several skills in one call, each once', async () => {
    const { skills, skill } = await load({ skillIds: ['Store', 'pet-catalog', 'store'] });

    expect(skills?.map((r) => r.skill.id)).toEqual(['store', 'pet-catalog']);
    expect(skills?.every((r) => r.isComplete)).toBe(true);
    expect(skill).toBeUndefined();
  });
});

describe('the tool descriptions (#1068)', () => {
  const descriptionOf = async (name: string) =>
    (await server.listTools()).tools.find((tool) => tool.name === name)?.description ?? '';

  it('tell the model to load a skill the catalog names directly', async () => {
    const description = await descriptionOf('search_skill');

    expect(description).toContain('call `load_skill` with that name directly: no\nsearch is needed');
    expect(description).not.toContain('Use\nthis tool first');
  });

  it('tell the model to load each skill once, and again only when its bundleVersion changed', async () => {
    const description = await descriptionOf('load_skill');

    expect(description).toContain('Load each skill once per conversation');
    expect(description).toContain('only when its `bundleVersion` changed');
    expect(description).toContain('`skillIds`');
  });
});
