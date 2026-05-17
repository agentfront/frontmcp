import * as os from 'os';
import * as path from 'path';

import { mkdtemp, readJSON, rm } from '@frontmcp/utils';

import { writeBinMeta } from '../bin-meta';
import type { FrontmcpExecConfig } from '../config';
import type { ExtractedSchema } from '../cli-runtime/schema-extractor';

function makeSchema(overrides?: Partial<ExtractedSchema>): ExtractedSchema {
  return {
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    jobs: [],
    capabilities: { skills: false, jobs: false, workflows: false },
    skillAssets: [],
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<FrontmcpExecConfig>): FrontmcpExecConfig {
  return {
    name: 'my-bin',
    version: '1.0.0',
    ...overrides,
  } as FrontmcpExecConfig;
}

describe('writeBinMeta (issue #411)', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-411-binmeta-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('writes a complete bin-meta.json with name, version, prompts, and skills', async () => {
    const schema = makeSchema({
      prompts: [
        { name: 'do-it', description: 'Do the thing', arguments: [{ name: 'target', required: true }] },
      ],
      skillAssets: [
        {
          skillName: 'review-pr',
          baseDir: '/abs/skill-src',
          instructionFile: '/abs/skill-src/SKILL.md',
          resourceDirs: { references: '/abs/skill-src/references' },
        },
      ],
    });
    await writeBinMeta(tmp, makeConfig({ name: 'my-bin', version: '1.2.3' }), schema);

    const meta = (await readJSON(path.join(tmp, 'bin-meta.json'))) as Record<string, unknown>;
    expect(meta.name).toBe('my-bin');
    expect(meta.version).toBe('1.2.3');
    expect(meta.description).toBe('my-bin (FrontMCP server)');
    expect(meta.mcpDefault).toEqual({ command: 'my-bin', args: ['serve', '--stdio'] });
    expect(meta.prompts).toEqual([
      { name: 'do-it', description: 'Do the thing', arguments: [{ name: 'target', required: true }] },
    ]);
    expect(meta.skills).toEqual([
      {
        name: 'review-pr',
        instructionFile: path.join('_skills', 'review-pr--SKILL.md'),
        resourceDirs: { references: path.join('_skills', 'review-pr--references') },
      },
    ]);
  });

  it('omits undefined skill fields (description, resourceDirs) instead of emitting "key: null"', async () => {
    const schema = makeSchema({
      skillAssets: [
        { skillName: 'no-resources', baseDir: '/abs', instructionFile: '/abs/SKILL.md' },
        { skillName: 'no-instr', baseDir: '/abs' },
      ],
    });
    await writeBinMeta(tmp, makeConfig(), schema);

    const meta = (await readJSON(path.join(tmp, 'bin-meta.json'))) as { skills: Record<string, unknown>[] };
    expect(meta.skills[0]).not.toHaveProperty('description');
    expect(meta.skills[0]).not.toHaveProperty('resourceDirs');
    expect(meta.skills[1]).not.toHaveProperty('instructionFile');
  });

  it('uses cli.description when provided in config', async () => {
    const config = makeConfig({ name: 'my-bin', cli: { description: 'My custom CLI' } as never });
    await writeBinMeta(tmp, config, makeSchema());

    const meta = (await readJSON(path.join(tmp, 'bin-meta.json'))) as { description: string };
    expect(meta.description).toBe('My custom CLI');
  });

  it('produces an empty skills array when no skills are extracted', async () => {
    await writeBinMeta(tmp, makeConfig(), makeSchema());
    const meta = (await readJSON(path.join(tmp, 'bin-meta.json'))) as { skills: unknown[]; prompts: unknown[] };
    expect(meta.skills).toEqual([]);
    expect(meta.prompts).toEqual([]);
  });
});
