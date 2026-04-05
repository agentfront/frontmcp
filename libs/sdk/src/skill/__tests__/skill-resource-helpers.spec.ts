/**
 * Skill Resource Helpers Tests
 *
 * Tests for the shared helper functions used by skills:// resource templates.
 */

import 'reflect-metadata';
import {
  getMcpVisibleSkills,
  getMcpVisibleSkillNames,
  findAndLoadSkill,
  readSkillFile,
  readAndParseSkillFile,
  collectAllReferenceNames,
  collectAllExampleNames,
} from '../resources/skill-resource.helpers';
import type { ScopeEntry, SkillEntry } from '../../common';
import type { SkillContent } from '../../common/interfaces';

// Mock @frontmcp/utils
jest.mock('@frontmcp/utils', () => ({
  readFile: jest.fn(),
  pathResolve: jest.fn((...parts: string[]) => parts.join('/')),
}));

import { readFile } from '@frontmcp/utils';
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

// Mock skill-md-parser
jest.mock('../skill-md-parser', () => ({
  parseSkillMdFrontmatter: jest.fn((content: string) => ({
    frontmatter: {},
    body: content,
  })),
}));

// Helper to create mock skill entry
function createMockSkillEntry(
  name: string,
  opts: {
    visibility?: 'mcp' | 'http' | 'both';
    tags?: string[];
    references?: Array<{ name: string; description: string; filename: string }>;
    examples?: Array<{ name: string; description: string; reference: string; level: string; filename: string }>;
  } = {},
): SkillEntry {
  const content: SkillContent = {
    id: name,
    name,
    description: `Description for ${name}`,
    instructions: 'Test instructions',
    tools: [],
    resolvedReferences: opts.references,
    resolvedExamples: opts.examples,
  };

  return {
    name,
    metadata: { visibility: opts.visibility ?? 'both' },
    getTags: () => opts.tags ?? [],
    load: jest.fn().mockResolvedValue(content),
    getBaseDir: () => '/skills/' + name,
    getResources: () => ({ references: 'references', examples: 'examples' }),
  } as unknown as SkillEntry;
}

// Helper to create mock scope with skill registry
function createMockScope(skills: SkillEntry[] = [], opts: { hasAny?: boolean } = {}): ScopeEntry {
  const registry = {
    hasAny: () => opts.hasAny ?? skills.length > 0,
    getSkills: jest.fn((options?: { visibility?: string }) => {
      if (options?.visibility === 'mcp') {
        return skills.filter((s) => {
          const vis = (s.metadata as any).visibility ?? 'both';
          return vis === 'mcp' || vis === 'both';
        });
      }
      return skills;
    }),
    findByName: jest.fn((name: string) => skills.find((s) => s.name === name)),
    loadSkill: jest.fn(async (name: string) => {
      const skill = skills.find((s) => s.name === name);
      if (!skill) return undefined;
      const content = await skill.load();
      return {
        skill: content,
        availableTools: [],
        missingTools: [],
        isComplete: true,
      };
    }),
  };

  return { skills: registry } as unknown as ScopeEntry;
}

describe('skill-resource.helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getMcpVisibleSkills', () => {
    it('should return empty array when no skills registry', () => {
      const scope = { skills: undefined } as unknown as ScopeEntry;
      expect(getMcpVisibleSkills(scope)).toEqual([]);
    });

    it('should return empty array when registry has no skills', () => {
      const scope = createMockScope([], { hasAny: false });
      expect(getMcpVisibleSkills(scope)).toEqual([]);
    });

    it('should return MCP-visible skills', () => {
      const skills = [
        createMockSkillEntry('skill-a', { visibility: 'mcp' }),
        createMockSkillEntry('skill-b', { visibility: 'http' }),
        createMockSkillEntry('skill-c', { visibility: 'both' }),
      ];
      const scope = createMockScope(skills);
      const result = getMcpVisibleSkills(scope);
      expect(scope.skills!.getSkills).toHaveBeenCalledWith({ visibility: 'mcp' });
      // The mock filters: mcp and both pass, http does not
      expect(result).toHaveLength(2);
    });
  });

  describe('getMcpVisibleSkillNames', () => {
    it('should return all names when no partial', () => {
      const skills = [createMockSkillEntry('alpha'), createMockSkillEntry('beta')];
      const scope = createMockScope(skills);
      const names = getMcpVisibleSkillNames(scope);
      expect(names).toEqual(['alpha', 'beta']);
    });

    it('should filter names by partial prefix', () => {
      const skills = [
        createMockSkillEntry('frontmcp-config'),
        createMockSkillEntry('frontmcp-deploy'),
        createMockSkillEntry('other-skill'),
      ];
      const scope = createMockScope(skills);
      const names = getMcpVisibleSkillNames(scope, 'front');
      expect(names).toEqual(['frontmcp-config', 'frontmcp-deploy']);
    });

    it('should return empty for no match', () => {
      const skills = [createMockSkillEntry('alpha')];
      const scope = createMockScope(skills);
      expect(getMcpVisibleSkillNames(scope, 'zzz')).toEqual([]);
    });
  });

  describe('findAndLoadSkill', () => {
    it('should load a skill by name', async () => {
      const skills = [createMockSkillEntry('my-skill')];
      const scope = createMockScope(skills);
      const result = await findAndLoadSkill(scope, 'my-skill');
      expect(result.loadResult.skill.name).toBe('my-skill');
    });

    it('should throw when no skills available', async () => {
      const scope = { skills: undefined } as unknown as ScopeEntry;
      await expect(findAndLoadSkill(scope, 'anything')).rejects.toThrow('not available');
    });

    it('should throw when skill not found', async () => {
      const scope = createMockScope([createMockSkillEntry('other')]);
      await expect(findAndLoadSkill(scope, 'missing')).rejects.toThrow('not found');
    });

    it('should throw when skill is not MCP-visible', async () => {
      const skills = [createMockSkillEntry('http-only', { visibility: 'http' })];
      const scope = createMockScope(skills);
      await expect(findAndLoadSkill(scope, 'http-only')).rejects.toThrow('not available via MCP');
    });

    it('should throw when loadSkill returns undefined', async () => {
      const mockEntry = createMockSkillEntry('broken');
      const scope = createMockScope([mockEntry]);
      (scope.skills!.loadSkill as jest.Mock).mockResolvedValue(undefined);
      await expect(findAndLoadSkill(scope, 'broken')).rejects.toThrow('Failed to load');
    });
  });

  describe('readSkillFile', () => {
    it('should read a reference file', async () => {
      mockReadFile.mockResolvedValue('# Reference content');
      const instance = createMockSkillEntry('test') as any;
      const result = await readSkillFile(instance, 'references', 'ref.md');
      expect(result).toBe('# Reference content');
    });

    it('should throw when no base dir', async () => {
      const instance = {
        getBaseDir: () => undefined,
        getResources: () => ({ references: 'refs' }),
      } as any;
      await expect(readSkillFile(instance, 'references', 'ref.md')).rejects.toThrow(
        'does not have a references directory',
      );
    });

    it('should throw when no resource path', async () => {
      const instance = {
        getBaseDir: () => '/base',
        getResources: () => undefined,
      } as any;
      await expect(readSkillFile(instance, 'references', 'ref.md')).rejects.toThrow(
        'does not have a references directory',
      );
    });

    it('should throw when file read fails', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      const instance = createMockSkillEntry('test') as any;
      await expect(readSkillFile(instance, 'references', 'missing.md')).rejects.toThrow(
        'Failed to read references file',
      );
    });
  });

  describe('readAndParseSkillFile', () => {
    it('should read and parse a file', async () => {
      mockReadFile.mockResolvedValue('---\nname: test\n---\n# Content');
      const instance = createMockSkillEntry('test') as any;
      const result = await readAndParseSkillFile(instance, 'references', 'ref.md');
      expect(result).toHaveProperty('frontmatter');
      expect(result).toHaveProperty('body');
    });
  });

  describe('collectAllReferenceNames', () => {
    it('should collect references from all skills', async () => {
      const skills = [
        createMockSkillEntry('s1', {
          references: [
            { name: 'ref-a', description: 'A', filename: 'ref-a.md' },
            { name: 'ref-b', description: 'B', filename: 'ref-b.md' },
          ],
        }),
        createMockSkillEntry('s2', {
          references: [{ name: 'ref-c', description: 'C', filename: 'ref-c.md' }],
        }),
      ];
      const scope = createMockScope(skills);
      const names = await collectAllReferenceNames(scope);
      expect(names).toEqual(['ref-a', 'ref-b', 'ref-c']);
    });

    it('should filter by partial', async () => {
      const skills = [
        createMockSkillEntry('s1', {
          references: [
            { name: 'configure-auth', description: 'A', filename: 'a.md' },
            { name: 'setup-redis', description: 'B', filename: 'b.md' },
          ],
        }),
      ];
      const scope = createMockScope(skills);
      const names = await collectAllReferenceNames(scope, 'conf');
      expect(names).toEqual(['configure-auth']);
    });

    it('should deduplicate names', async () => {
      const skills = [
        createMockSkillEntry('s1', {
          references: [{ name: 'shared-ref', description: 'A', filename: 'a.md' }],
        }),
        createMockSkillEntry('s2', {
          references: [{ name: 'shared-ref', description: 'B', filename: 'b.md' }],
        }),
      ];
      const scope = createMockScope(skills);
      const names = await collectAllReferenceNames(scope);
      expect(names).toEqual(['shared-ref']);
    });

    it('should skip skills that fail to load', async () => {
      const goodSkill = createMockSkillEntry('good', {
        references: [{ name: 'ref', description: 'A', filename: 'a.md' }],
      });
      const badSkill = createMockSkillEntry('bad');
      (badSkill.load as jest.Mock).mockRejectedValue(new Error('fail'));

      const scope = createMockScope([goodSkill, badSkill]);
      const names = await collectAllReferenceNames(scope);
      expect(names).toEqual(['ref']);
    });
  });

  describe('collectAllExampleNames', () => {
    it('should collect examples from all skills', async () => {
      const skills = [
        createMockSkillEntry('s1', {
          examples: [{ name: 'ex-1', description: 'E1', reference: 'ref', level: 'basic', filename: 'e1.md' }],
        }),
      ];
      const scope = createMockScope(skills);
      const names = await collectAllExampleNames(scope);
      expect(names).toEqual(['ex-1']);
    });

    it('should filter by partial', async () => {
      const skills = [
        createMockSkillEntry('s1', {
          examples: [
            { name: 'basic-setup', description: 'E1', reference: 'ref', level: 'basic', filename: 'e1.md' },
            { name: 'advanced-config', description: 'E2', reference: 'ref', level: 'advanced', filename: 'e2.md' },
          ],
        }),
      ];
      const scope = createMockScope(skills);
      const names = await collectAllExampleNames(scope, 'adv');
      expect(names).toEqual(['advanced-config']);
    });
  });
});
