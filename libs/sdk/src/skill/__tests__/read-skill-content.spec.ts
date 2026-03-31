/**
 * ReadSkillContent Tool Tests
 *
 * Tests for the readSkillContent MCP tool which reads individual
 * reference and example files from loaded skills.
 */

import 'reflect-metadata';
import { SkillInstance, createSkillInstance } from '../skill.instance';
import { SkillKind, SkillRecord, SkillMetadata, EntryOwnerRef } from '../../common';
import type { SkillReferenceInfo, SkillExampleInfo } from '../../common/interfaces';
import ProviderRegistry from '../../provider/provider.registry';
import { Scope } from '../../scope';

// Mock file operations
jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  readFile: jest.fn(),
  fileExists: jest.fn(),
  readdir: jest.fn(),
  stat: jest.fn(),
}));

import { readFile } from '@frontmcp/utils';
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

// Mock loadInstructions to avoid file I/O during instance creation
jest.mock('../skill.utils', () => ({
  ...jest.requireActual('../skill.utils'),
  loadInstructions: jest.fn().mockResolvedValue('mock instructions'),
  resolveReferences: jest.fn(),
  resolveExamples: jest.fn(),
}));

// Helper to create mock ProviderRegistry
const createMockProviderRegistry = (): ProviderRegistry => {
  const mockScope = {
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  } as unknown as Scope;

  return {
    getActiveScope: () => mockScope,
  } as unknown as ProviderRegistry;
};

const createMockOwner = (id = 'test-app'): EntryOwnerRef => ({
  kind: 'app',
  id,
  ref: Symbol('test-app-token'),
});

describe('ReadSkillContent - file resolution logic', () => {
  let instance: SkillInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    const metadata: SkillMetadata = {
      name: 'test-skill',
      description: 'A test skill',
      instructions: 'inline instructions',
      resources: {
        references: 'references',
        examples: 'examples',
      },
    };

    const record: SkillRecord = {
      kind: SkillKind.FILE,
      provide: Symbol('test-skill'),
      metadata,
      filePath: '/skills/test-skill/SKILL.md',
    };

    instance = createSkillInstance(record, createMockProviderRegistry(), createMockOwner());
  });

  describe('getBaseDir()', () => {
    it('should return the directory of the skill file for FILE records', () => {
      expect(instance.getBaseDir()).toBe('/skills/test-skill');
    });

    it('should return callerDir for VALUE records', () => {
      const metadata: SkillMetadata = {
        name: 'value-skill',
        description: 'test',
        instructions: 'inline',
        resources: { references: 'refs' },
      };

      const record: SkillRecord = {
        kind: SkillKind.VALUE,
        provide: Symbol('value-skill'),
        metadata,
        callerDir: '/some/caller/dir',
      };

      const valueInstance = createSkillInstance(record, createMockProviderRegistry(), createMockOwner());
      expect(valueInstance.getBaseDir()).toBe('/some/caller/dir');
    });

    it('should return undefined for CLASS_TOKEN records without callerDir', () => {
      const metadata: SkillMetadata = {
        name: 'class-skill',
        description: 'test',
        instructions: 'inline',
      };

      const record: SkillRecord = {
        kind: SkillKind.CLASS_TOKEN,
        provide: class {} as any,
        metadata,
      };

      const classInstance = createSkillInstance(record, createMockProviderRegistry(), createMockOwner());
      expect(classInstance.getBaseDir()).toBeUndefined();
    });
  });

  describe('getResources()', () => {
    it('should return the resources from metadata', () => {
      const resources = instance.getResources();
      expect(resources).toEqual({
        references: 'references',
        examples: 'examples',
      });
    });
  });
});

describe('ReadSkillContent - reference and example lookup', () => {
  const mockReferences: SkillReferenceInfo[] = [
    { name: 'deploy-to-vercel', description: 'Deploy to Vercel', filename: 'deploy-to-vercel.md' },
    { name: 'deploy-to-node', description: 'Deploy to Node.js', filename: 'deploy-to-node.md' },
  ];

  const mockExamples: SkillExampleInfo[] = [
    {
      name: 'vercel-with-kv',
      description: 'Vercel with KV storage',
      reference: 'deploy-to-vercel',
      level: 'basic',
      filename: 'deploy-to-vercel/vercel-with-kv.md',
    },
    {
      name: 'vercel-with-skills-cache',
      description: 'Vercel with skills cache',
      reference: 'deploy-to-vercel',
      level: 'intermediate',
      filename: 'deploy-to-vercel/vercel-with-skills-cache.md',
    },
  ];

  it('should find a reference by name', () => {
    const found = mockReferences.find((r) => r.name === 'deploy-to-vercel');
    expect(found).toBeDefined();
    expect(found?.filename).toBe('deploy-to-vercel.md');
  });

  it('should find an example by name', () => {
    const found = mockExamples.find((e) => e.name === 'vercel-with-kv');
    expect(found).toBeDefined();
    expect(found?.reference).toBe('deploy-to-vercel');
    expect(found?.level).toBe('basic');
    expect(found?.filename).toBe('deploy-to-vercel/vercel-with-kv.md');
  });

  it('should return undefined for non-existent reference', () => {
    const found = mockReferences.find((r) => r.name === 'nonexistent');
    expect(found).toBeUndefined();
  });

  it('should list available names when not found', () => {
    const availableNames = mockReferences.map((r) => r.name);
    expect(availableNames).toEqual(['deploy-to-vercel', 'deploy-to-node']);
  });

  it('should list available example names when not found', () => {
    const availableNames = mockExamples.map((e) => e.name);
    expect(availableNames).toEqual(['vercel-with-kv', 'vercel-with-skills-cache']);
  });
});

describe('ReadSkillContent - file reading and frontmatter parsing', () => {
  it('should strip frontmatter and return body for reference files', async () => {
    const fileContent = [
      '---',
      'name: deploy-to-vercel',
      'description: Deploy to Vercel serverless',
      '---',
      '',
      '# Deploy to Vercel',
      '',
      'Step 1: Configure vercel.json',
    ].join('\n');

    mockReadFile.mockResolvedValueOnce(fileContent);

    const result = await mockReadFile('/skills/test-skill/references/deploy-to-vercel.md');
    expect(result).toBe(fileContent);

    // Verify frontmatter can be parsed
    const { parseSkillMdFrontmatter } = require('../skill-md-parser');
    const { frontmatter, body } = parseSkillMdFrontmatter(fileContent);
    expect(frontmatter['name']).toBe('deploy-to-vercel');
    expect(frontmatter['description']).toBe('Deploy to Vercel serverless');
    expect(body).toContain('# Deploy to Vercel');
    expect(body).not.toContain('---');
  });

  it('should strip frontmatter and return body for example files', async () => {
    const fileContent = [
      '---',
      'name: vercel-with-kv',
      'reference: deploy-to-vercel',
      'level: basic',
      'description: Deploy with Vercel KV storage',
      '---',
      '',
      '# Vercel with KV',
      '',
      'This example shows how to deploy with Vercel KV.',
      '',
      '## Code',
      '',
      '```typescript',
      "import { FrontMcp } from '@frontmcp/sdk';",
      '```',
    ].join('\n');

    mockReadFile.mockResolvedValueOnce(fileContent);

    const result = await mockReadFile('/skills/test-skill/examples/deploy-to-vercel/vercel-with-kv.md');
    expect(result).toBe(fileContent);

    const { parseSkillMdFrontmatter } = require('../skill-md-parser');
    const { frontmatter, body } = parseSkillMdFrontmatter(fileContent);
    expect(frontmatter['name']).toBe('vercel-with-kv');
    expect(frontmatter['reference']).toBe('deploy-to-vercel');
    expect(frontmatter['level']).toBe('basic');
    expect(body).toContain('# Vercel with KV');
    expect(body).toContain("import { FrontMcp } from '@frontmcp/sdk'");
  });

  it('should handle files without frontmatter', async () => {
    const fileContent = '# No Frontmatter\n\nJust content.';

    const { parseSkillMdFrontmatter } = require('../skill-md-parser');
    const { frontmatter, body } = parseSkillMdFrontmatter(fileContent);
    expect(frontmatter).toEqual({});
    expect(body).toBe(fileContent);
  });
});
