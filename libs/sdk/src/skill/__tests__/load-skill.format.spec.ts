/**
 * `skills/load`'s `format`: `'full'` (the default) and `'instructions-only'` send the fields and `formattedContent`, as
 * 1.11.0 did (#1125), and `'markdown'` sends `formattedContent` alone, so each part of the skill goes once (#1066).
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, LogLevel, skill, tool } from '../../common';
import {
  connect,
  type DirectClient,
  type LoadSkillsFormat,
  type LoadSkillsOptions,
  type LoadSkillsResult,
} from '../../direct';

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
  it("'full' (the default) sends the instructions, the tool's input schema and formattedContent, as 1.11.0 did", async () => {
    const {
      skills: [loaded],
    } = await client.loadSkills(['stock-check']);

    expect(loaded.instructions).toContain('Call count_pets with the status');
    expect(loaded.tools[0].inputSchema).toMatchObject({ properties: { status: { type: 'string' } } });
    expect(loaded.formattedContent).toContain('# Skill: stock-check');
    expect(loaded.formattedContent).toContain('**Input Schema:**');
    expect(loaded.formattedContent).toContain('Call count_pets with the status');
  });

  it("'markdown' sends formattedContent, which holds the instructions and the schema, without the fields", async () => {
    const {
      skills: [loaded],
    } = await client.loadSkills(['stock-check'], { format: 'markdown' });

    expect(loaded.formattedContent).toContain('**Input Schema:**');
    expect(loaded.formattedContent).toContain('Call count_pets with the status');
    expect(loaded.instructions).toBeUndefined();
    expect(loaded.parameters).toBeUndefined();
    expect(loaded.tools[0]).toEqual({ name: 'count_pets', available: true });
  });

  it("'instructions-only' leaves the tool schema out of the tool and of formattedContent", async () => {
    const {
      skills: [loaded],
    } = await client.loadSkills(['stock-check'], { format: 'instructions-only' });

    expect(loaded.instructions).toContain('Call count_pets with the status');
    expect(loaded.tools[0].inputSchema).toBeUndefined();
    expect(loaded.formattedContent).toContain('- [✓] `count_pets`');
    expect(loaded.formattedContent).toContain('Call count_pets with the status');
    expect(loaded.formattedContent).not.toContain('Input Schema');
  });

  it("'markdown' sends each part once: the instructions appear once in the response", async () => {
    const json = JSON.stringify(await client.loadSkills(['stock-check'], { format: 'markdown' }));

    expect(json.split('Call count_pets with the status').length - 1).toBe(1);
  });

  it("types the default load's instructions and formattedContent as strings, as 1.11.0 did", async () => {
    const options: LoadSkillsOptions = { format: 'full' };
    const result: LoadSkillsResult = await client.loadSkills(['stock-check'], options);
    const {
      skills: [byDefault],
    } = await client.loadSkills(['stock-check'], { activateSession: false });

    const instructions: string = result.skills[0].instructions;
    const formattedContent: string = byDefault.formattedContent;

    expect(instructions).toBe(byDefault.instructions);
    expect(formattedContent).toBe(result.skills[0].formattedContent);
  });

  it("types a 'markdown' load without instructions", async () => {
    const {
      skills: [asMarkdown],
    } = await client.loadSkills(['stock-check'], { format: 'markdown' });

    const formattedContent: string = asMarkdown.formattedContent;
    // @ts-expect-error a markdown load sends no instructions
    const instructions: string = asMarkdown.instructions;

    expect(formattedContent).toContain('Call count_pets with the status');
    expect(instructions).toBeUndefined();
  });

  it('types a load whose format is only known at runtime with optional instructions', async () => {
    const format: LoadSkillsFormat = 'markdown';
    const {
      skills: [loaded],
    } = await client.loadSkills(['stock-check'], { format });

    // @ts-expect-error a 'markdown' load sends no instructions
    const instructions: string = loaded.instructions;

    expect(instructions).toBeUndefined();
  });
});
