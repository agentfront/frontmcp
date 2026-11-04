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

describe('stop words (#1061)', () => {
  it('match nothing, so a query with them ranks as the query without them', async () => {
    expect(await search({ query: 'show me the cats' })).toEqual(['pet-catalog']);
    expect(await search({ query: 'show me three of the cats' })).toEqual(['pet-catalog']);
    expect(await search({ query: 'the' })).toEqual([]);
  });
});

describe('words in every script (#1065)', () => {
  let multilingual: DirectMcpServer;

  beforeAll(async () => {
    multilingual = await petShop([
      PET_SHOP[0],
      { ...PET_SHOP[0], id: 'katalog', name: 'Katalog', description: 'Hunde, Katzen und Vögel finden.', tags: [] },
      { ...PET_SHOP[0], id: 'katalog-he', name: 'קטלוג', description: 'מציאת כלבים, חתולים וציפורים.', tags: [] },
      { ...PET_SHOP[0], id: 'mulu', name: '目录', description: '查找狗、猫和鸟。', tags: [] },
      PET_SHOP[1],
    ]);
  });

  afterAll(async () => {
    await multilingual?.dispose();
  });

  const scored = async (query: string) =>
    ((await multilingual.callTool('search_skill', { query })).structuredContent as unknown as Found).skills;

  it('ranks a skill by a word in its own script, not by a keyword match', async () => {
    for (const [query, id] of [
      ['חתולים', 'katalog-he'],
      ['猫', 'mulu'],
      ['查找', 'mulu'],
      ['Katzen', 'katalog'],
    ]) {
      const found = await scored(query);
      expect(found.map((s) => s.skillId)).toEqual([id]);
      expect(found[0].score).toBeLessThan(1);
    }
  });

  it('ranks every skill a query in two scripts matches', async () => {
    expect((await scored('חתולים cats')).map((s) => s.skillId).sort()).toEqual(['katalog-he', 'pet-catalog']);
  });

  it('matches a word with or without its accent, and not by a fragment of another word', async () => {
    expect((await scored('Vogel')).map((s) => s.skillId)).toEqual(['katalog']);
    expect(await scored('Nägel schneiden')).toEqual([]);
  });
});

describe('a decision model (#1062)', () => {
  let decided: DirectMcpServer;
  const requests: Array<{ query: string; candidates: string[] }> = [];

  beforeAll(async () => {
    const bundle = await compileSkilledBundleFromOpenApi(spec, PET_SHOP, {
      bundleId: 'shop',
      version: '1.0.0',
      baseUrl: 'https://shop.example',
    });
    decided = await FrontMcpInstance.createDirect({
      info: { name: 'shop', version: '1.0.0' },
      apps: [],
      logging: { level: LogLevel.Off },
      skillsConfig: {
        decision: {
          // A decision model that knows kittens are cats
          decider: async ({ query, candidates }) => {
            requests.push({ query, candidates: candidates.map((c) => c.id).sort() });
            return query === 'kittens' ? [{ id: 'pet-catalog', probability: 0.93 }] : [];
          },
        },
      },
      plugins: [SkilledOpenApiPlugin.init({ source: { type: 'inline', content: bundle }, requireSignature: false })],
    });
  });

  afterAll(async () => {
    await decided?.dispose();
  });

  it('finds a skill by meaning, for a query that shares no word with it', async () => {
    const found = ((await decided.callTool('search_skill', { query: 'kittens' })).structuredContent as unknown as Found)
      .skills;

    expect(found.map((s) => [s.skillId, s.score])).toEqual([['pet-catalog', 0.93]]);
    expect(requests.at(-1)).toEqual({ query: 'kittens', candidates: ['pet-catalog', 'store'] });
  });
});
