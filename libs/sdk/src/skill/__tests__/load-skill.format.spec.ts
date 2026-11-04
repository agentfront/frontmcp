/**
 * `skills/load`'s `format` sends each part of a skill once (#1066): `'full'` the structured fields with the tool
 * schemas, `'markdown'` the `formattedContent` rendering in their place, `'instructions-only'` no tool schemas.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, LogLevel, skill, tool } from '../../common';
import { connect, type DirectClient } from '../../direct';

const countPets = tool({
  name: 'count_pets',
  description: 'Count the pets in stock.',
  inputSchema: { status: z.string() },
})(async ({ status }) => ({ status, count: 3 }));

const stockCheck = skill({
  name: 'stock-check',
  description: 'Count the pets in stock.',
  instructions: '# Stock check\n\nCall count_pets with the status the user asks for, then report the count.',
  tools: ['count_pets'],
});

@App({ id: 'shop', name: 'Shop', tools: [countPets], skills: [stockCheck] })
class ShopApp {}

let client: DirectClient;

beforeAll(async () => {
  client = await connect({
    info: { name: 'shop', version: '1.0.0' },
    logging: { level: LogLevel.Off },
    apps: [ShopApp],
  });
});

afterAll(async () => {
  await client?.close();
});

describe('skills/load format', () => {
  it("'full' (the default) sends the instructions and the tool's input schema once, with no markdown", async () => {
    const {
      skills: [loaded],
    } = await client.loadSkills(['stock-check']);

    expect(loaded.instructions).toContain('Call count_pets with the status');
    expect(loaded.tools[0].inputSchema).toMatchObject({ properties: { status: { type: 'string' } } });
    expect(loaded.formattedContent).toBeUndefined();
  });

  it("'markdown' sends the rendering, which holds the instructions and the schema, in place of the fields", async () => {
    const {
      skills: [loaded],
    } = await client.loadSkills(['stock-check'], { format: 'markdown' });

    expect(loaded.formattedContent).toContain('**Input Schema:**');
    expect(loaded.formattedContent).toContain('Call count_pets with the status');
    expect(loaded.instructions).toBeUndefined();
    expect(loaded.tools[0]).toEqual({ name: 'count_pets', available: true });
  });

  it("'instructions-only' sends the instructions without the tool schema, and no markdown", async () => {
    const {
      skills: [loaded],
    } = await client.loadSkills(['stock-check'], { format: 'instructions-only' });

    expect(loaded.instructions).toContain('Call count_pets with the status');
    expect(loaded.tools[0].inputSchema).toBeUndefined();
    expect(loaded.formattedContent).toBeUndefined();
  });

  it('sends each part once: the instructions appear once in every format', async () => {
    for (const format of ['full', 'markdown', 'instructions-only'] as const) {
      const json = JSON.stringify(await client.loadSkills(['stock-check'], { format }));
      expect(json.split('Call count_pets with the status').length - 1).toBe(1);
    }
  });
});
