/**
 * How `search_skill` finds and ranks bundle skills, on the pet shop of the skill-search issues: a server from
 * `createDirect()` with the plugin and a bundle compiled from an OpenAPI document.
 */
import 'reflect-metadata';

import { compileSkilledBundleFromOpenApi, type SkillOpenApiRef } from '@frontmcp/adapters/skills';
import { FrontMcpInstance, LogLevel, type DirectMcpServer } from '@frontmcp/sdk';

import { SkilledOpenApiPlugin } from '../index';

const operation = (operationId: string, summary: string) => ({
  get: { operationId, summary, responses: { 200: { description: 'OK' } } },
});

const spec = {
  openapi: '3.0.3',
  info: { title: 'Pet shop', version: '1.0.0' },
  paths: {
    '/pets': operation('findPets', 'Finds pets.'),
    '/store/inventory': operation('getInventory', 'Returns pet inventories by status.'),
  },
};

const PET_SHOP: SkillOpenApiRef[] = [
  {
    id: 'pet-catalog',
    name: 'Pet catalog',
    description: 'Find dogs, cats and birds.',
    instructions: '# Pet catalog',
    operationIds: ['findPets'],
    tags: ['puppies'],
  },
  {
    id: 'store',
    name: 'Store',
    description: 'Count the pets in stock, and read an order.',
    instructions: '# Store\n\nUse getInventory for the inventory.',
    operationIds: ['getInventory'],
  },
];

interface Found {
  skills: Array<{ skillId: string; score: number }>;
}

async function petShop(skills: SkillOpenApiRef[] = PET_SHOP): Promise<DirectMcpServer> {
  const bundle = await compileSkilledBundleFromOpenApi(spec, skills, {
    bundleId: 'shop',
    version: '1.0.0',
    baseUrl: 'https://shop.example',
  });
  return FrontMcpInstance.createDirect({
    info: { name: 'shop', version: '1.0.0' },
    apps: [],
    logging: { level: LogLevel.Off },
    plugins: [SkilledOpenApiPlugin.init({ source: { type: 'inline', content: bundle }, requireSignature: false })],
  });
}

let server: DirectMcpServer;

beforeAll(async () => {
  server = await petShop();
});

afterAll(async () => {
  await server?.dispose();
});

const search = async (args: Record<string, unknown>, on: DirectMcpServer = server): Promise<string[]> =>
  ((await on.callTool('search_skill', args)).structuredContent as unknown as Found).skills.map((s) => s.skillId);

describe('a bundle skill’s tags (#1058)', () => {
  it('are what the tags filter matches', async () => {
    expect(await search({ query: 'dogs', tags: ['puppies'] })).toEqual(['pet-catalog']);
  });

  it('leave out a skill without them', async () => {
    expect((await search({ query: 'dogs stock' })).sort()).toEqual(['pet-catalog', 'store']);
    expect(await search({ query: 'dogs stock', tags: ['puppies'] })).toEqual(['pet-catalog']);
  });

  it('are searched', async () => {
    expect(await search({ query: 'puppies' })).toEqual(['pet-catalog']);
  });
});

describe('a bundle skill’s operations and instructions (#1060)', () => {
  it('find it by a word of an operation’s summary', async () => {
    expect(await search({ query: 'inventories by status' })).toEqual(['store']);
  });

  it('find it by an operation id, whole or as words', async () => {
    expect(await search({ query: 'getInventory' })).toEqual(['store']);
    expect(await search({ query: 'inventory' })).toEqual(['store']);
  });

  it('rank it first when they match more of the query than another skill’s name', async () => {
    expect((await search({ query: 'pet inventories' }))[0]).toBe('store');
  });
});

describe('the anti-query (#1059)', () => {
  it('keeps the skill it demotes demoted', async () => {
    expect((await search({ query: 'pets' })).sort()).toEqual(['pet-catalog', 'store']);
    expect(await search({ query: 'pets', notQuery: 'stock' })).toEqual(['pet-catalog']);
  });

  it('never brings back the only match with a higher score', async () => {
    expect(await search({ query: 'order' })).toEqual(['store']);
    expect(await search({ query: 'order', notQuery: 'stock' })).toEqual([]);
  });
});
