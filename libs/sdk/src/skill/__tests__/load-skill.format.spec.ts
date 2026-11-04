/**
 * `skills/load`'s `format`: `'full'` sends each tool's input schema, in `tools[].inputSchema` and in
 * `formattedContent`, and `'instructions-only'` leaves the schemas out of both (#1066).
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
  it("'full' sends the tool's input schema with the tool and in the markdown", async () => {
    const {
      skills: [loaded],
    } = await client.loadSkills(['stock-check'], { format: 'full' });

    expect(loaded.tools[0].inputSchema).toMatchObject({ properties: { status: { type: 'string' } } });
    expect(loaded.formattedContent).toContain('**Input Schema:**');
    expect(loaded.formattedContent).toContain('Call count_pets with the status');
  });

  it("'instructions-only' leaves the schema out of the tool and of the markdown", async () => {
    const {
      skills: [loaded],
    } = await client.loadSkills(['stock-check'], { format: 'instructions-only' });

    expect(loaded.tools[0].inputSchema).toBeUndefined();
    expect(loaded.formattedContent).not.toContain('Input Schema');
    expect(loaded.formattedContent).not.toContain('"status"');
    expect(loaded.formattedContent).toContain('- [✓] `count_pets`');
    expect(loaded.formattedContent).toContain('Call count_pets with the status');
  });
});
