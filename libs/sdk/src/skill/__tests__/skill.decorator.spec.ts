/**
 * Skill Decorator Tests
 *
 * Tests for @Skill decorator and skill() helper function.
 */

import 'reflect-metadata';

import { dirname } from '@frontmcp/utils';

import { skillCallerDir, SkillContext, SkillKind, type SkillContent, type SkillMetadata } from '../../common';
import {
  FrontMcpSkill,
  frontMcpSkill,
  getSkillMetadata,
  isSkillDecorated,
  Skill,
  skill,
} from '../../common/decorators/skill.decorator';
import { parseCallerDir as parseCallerDirShared } from '../../common/utils/caller-dir.utils';

const THIS_DIR = __dirname;

// The skill decorator skips its own file by basename; the spec exercises the
// shared parser with the same skip list so behavior matches `@Skill`.
const SKILL_SKIP = ['skill.decorator.ts', 'skill.decorator.js'];
const parseCallerDir = (stack: string | undefined): string | undefined => parseCallerDirShared(stack, SKILL_SKIP);

// Mock SkillContext for testing
class MockSkillContext extends SkillContext {
  async loadInstructions(): Promise<string> {
    return this.metadata.instructions as string;
  }

  async build(): Promise<SkillContent> {
    return {
      id: this.skillId,
      name: this.skillName,
      description: this.metadata.description,
      instructions: await this.loadInstructions(),
      tools: this.getToolRefs().map((t) => ({ name: t.name, purpose: t.purpose })),
    };
  }
}

describe('skill.decorator', () => {
  describe('FrontMcpSkill decorator', () => {
    it('should decorate a class with skill metadata', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Do something',
      };

      @FrontMcpSkill(metadata)
      class TestSkill extends MockSkillContext {}

      expect(isSkillDecorated(TestSkill)).toBe(true);
    });

    it('should store metadata that can be retrieved', () => {
      const metadata: SkillMetadata = {
        name: 'retrievable-skill',
        description: 'A skill with retrievable metadata',
        instructions: 'Step 1: Do this',
        tools: ['tool1', 'tool2'],
        tags: ['test', 'example'],
      };

      @FrontMcpSkill(metadata)
      class RetrievableSkill extends MockSkillContext {}

      const retrieved = getSkillMetadata(RetrievableSkill);
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('retrievable-skill');
      expect(retrieved?.description).toBe('A skill with retrievable metadata');
      expect(retrieved?.tools).toEqual(['tool1', 'tool2']);
      expect(retrieved?.tags).toEqual(['test', 'example']);
    });

    it('should validate metadata and throw on invalid', () => {
      const invalidMetadata = {
        name: '', // Empty name is invalid
        description: 'A skill',
        instructions: 'Do something',
      };

      expect(() => {
        @FrontMcpSkill(invalidMetadata as SkillMetadata)
        class InvalidSkill extends MockSkillContext {}
        return InvalidSkill;
      }).toThrow();
    });

    it('should handle file-based instructions', () => {
      const metadata: SkillMetadata = {
        name: 'file-skill',
        description: 'Skill with file instructions',
        instructions: { file: './skills/test.md' },
      };

      @FrontMcpSkill(metadata)
      class FileSkill extends MockSkillContext {}

      const retrieved = getSkillMetadata(FileSkill);
      expect(retrieved?.instructions).toEqual({ file: './skills/test.md' });
    });

    it('should handle URL-based instructions', () => {
      const metadata: SkillMetadata = {
        name: 'url-skill',
        description: 'Skill with URL instructions',
        instructions: { url: 'https://example.com/skill.md' },
      };

      @FrontMcpSkill(metadata)
      class UrlSkill extends MockSkillContext {}

      const retrieved = getSkillMetadata(UrlSkill);
      expect(retrieved?.instructions).toEqual({ url: 'https://example.com/skill.md' });
    });
  });

  describe('Skill alias', () => {
    it('should be an alias for FrontMcpSkill', () => {
      expect(Skill).toBe(FrontMcpSkill);
    });

    it('should work as a decorator', () => {
      @Skill({
        name: 'alias-skill',
        description: 'Using the alias',
        instructions: 'Do something',
      })
      class AliasSkill extends MockSkillContext {}

      expect(isSkillDecorated(AliasSkill)).toBe(true);
      const metadata = getSkillMetadata(AliasSkill);
      expect(metadata?.name).toBe('alias-skill');
    });
  });

  describe('frontMcpSkill function helper', () => {
    it('should create a SkillValueRecord', () => {
      const record = frontMcpSkill({
        name: 'inline-skill',
        description: 'An inline skill',
        instructions: 'Do something inline',
      });

      expect(record.kind).toBe(SkillKind.VALUE);
      expect(typeof record.provide).toBe('symbol');
      expect(record.metadata.name).toBe('inline-skill');
      expect(record.metadata.description).toBe('An inline skill');
    });

    it('should validate metadata', () => {
      expect(() => {
        frontMcpSkill({
          name: '',
          description: 'Invalid skill',
          instructions: 'Do something',
        });
      }).toThrow();
    });

    it('should create unique symbols for each skill', () => {
      const record1 = frontMcpSkill({
        name: 'skill-1',
        description: 'First skill',
        instructions: 'Instructions 1',
      });

      const record2 = frontMcpSkill({
        name: 'skill-2',
        description: 'Second skill',
        instructions: 'Instructions 2',
      });

      expect(record1.provide).not.toBe(record2.provide);
    });

    it('should preserve all metadata fields', () => {
      const record = frontMcpSkill({
        id: 'custom-id',
        name: 'full-skill',
        description: 'Fully configured',
        instructions: 'Detailed instructions',
        tools: [{ name: 'tool1', purpose: 'Does thing 1', required: true }, 'tool2'],
        tags: ['tag1', 'tag2'],
        parameters: [{ name: 'param1', description: 'First param', required: true }],
        examples: [{ scenario: 'Example scenario', expectedOutcome: 'Expected result' }],
        priority: 5,
        hideFromDiscovery: true,
      });

      expect(record.metadata.id).toBe('custom-id');
      expect(record.metadata.priority).toBe(5);
      expect(record.metadata.hideFromDiscovery).toBe(true);
      expect(record.metadata.tools).toHaveLength(2);
      expect(record.metadata.tags).toEqual(['tag1', 'tag2']);
    });
  });

  describe('skill alias', () => {
    it('should be an alias for frontMcpSkill', () => {
      expect(skill).toBe(frontMcpSkill);
    });

    it('should work as a function', () => {
      const record = skill({
        name: 'alias-inline-skill',
        description: 'Using the alias function',
        instructions: 'Do something',
      });

      expect(record.kind).toBe(SkillKind.VALUE);
      expect(record.metadata.name).toBe('alias-inline-skill');
    });
  });

  describe('isSkillDecorated', () => {
    it('should return true for decorated class', () => {
      @Skill({
        name: 'decorated-skill',
        description: 'A decorated skill',
        instructions: 'Do something',
      })
      class DecoratedSkill extends MockSkillContext {}

      expect(isSkillDecorated(DecoratedSkill)).toBe(true);
    });

    it('should return false for non-decorated class', () => {
      class PlainClass {}

      expect(isSkillDecorated(PlainClass)).toBe(false);
    });

    it('should return false for plain object', () => {
      const obj = { name: 'not-a-skill' };
      expect(isSkillDecorated(obj)).toBe(false);
    });
  });

  describe('getSkillMetadata', () => {
    it('should return metadata for decorated class', () => {
      @Skill({
        name: 'metadata-skill',
        description: 'Skill with metadata',
        instructions: 'Instructions here',
        priority: 10,
      })
      class MetadataSkill extends MockSkillContext {}

      const metadata = getSkillMetadata(MetadataSkill);
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('metadata-skill');
      expect(metadata?.priority).toBe(10);
    });

    it('should return undefined for non-decorated class', () => {
      class PlainClass {}

      const metadata = getSkillMetadata(PlainClass);
      expect(metadata).toBeUndefined();
    });
  });

  describe('callerDir capture (issue #413)', () => {
    it('should record the caller directory on a decorated class', () => {
      @Skill({
        name: 'caller-dir-skill',
        description: 'A skill that should capture its caller directory',
        instructions: 'Inline instructions',
      })
      class CallerDirSkill extends MockSkillContext {}

      const dir = Reflect.getMetadata(skillCallerDir, CallerDirSkill) as string | undefined;
      // The decorator captured the source file's directory, which is this test file's directory.
      expect(dir).toBe(THIS_DIR);
    });

    it('should record the caller directory on a skill() helper record', () => {
      const record = skill({
        name: 'caller-dir-value',
        description: 'A value skill that should capture its caller directory',
        instructions: 'Inline instructions',
      });

      expect(record.callerDir).toBe(THIS_DIR);
    });

    describe('parseCallerDir (pure)', () => {
      it('returns the dirname of the first user CJS frame', () => {
        const stack = [
          'Error',
          '    at resolveCallerDir (/abs/path/sdk/src/common/decorators/skill.decorator.ts:175:15)',
          '    at FrontMcpSkill (/abs/path/sdk/src/common/decorators/skill.decorator.ts:76:21)',
          '    at Object.<anonymous> (/abs/path/user/src/my-skill.ts:12:1)',
          '    at Module._compile (node:internal/modules/cjs/loader:1356:14)',
        ].join('\n');

        expect(parseCallerDir(stack)).toBe('/abs/path/user/src');
      });

      it('returns the dirname of the first user ESM frame (file:// URL)', () => {
        const stack = [
          'Error',
          '    at FrontMcpSkill (/abs/path/sdk/src/common/decorators/skill.decorator.ts:76:21)',
          '    at file:///abs/path/user/src/my-skill.ts:12:1',
          '    at ModuleJob.run (node:internal/modules/esm/module_job:218:25)',
        ].join('\n');

        const result = parseCallerDir(stack);
        // POSIX result; on Windows the value would be C:-style. Compare via dirname()
        // so the assertion stays platform-tolerant.
        expect(result).toBe(dirname('/abs/path/user/src/my-skill.ts'));
      });

      it('skips node_modules frames', () => {
        const stack = [
          'Error',
          '    at FrontMcpSkill (/abs/path/sdk/src/common/decorators/skill.decorator.ts:76:21)',
          '    at someHelper (/abs/path/node_modules/some-lib/index.js:42:7)',
          '    at Object.<anonymous> (/abs/path/user/src/my-skill.ts:12:1)',
        ].join('\n');

        expect(parseCallerDir(stack)).toBe('/abs/path/user/src');
      });

      it('skips node: internal frames', () => {
        const stack = [
          'Error',
          '    at FrontMcpSkill (/abs/path/sdk/src/common/decorators/skill.decorator.ts:76:21)',
          '    at processTicksAndRejections (node:internal/process/task_queues:104:5)',
          '    at Object.<anonymous> (/abs/path/user/src/my-skill.ts:12:1)',
        ].join('\n');

        expect(parseCallerDir(stack)).toBe('/abs/path/user/src');
      });

      it('skips the decorator file itself but accepts skill.decorator.spec.ts', () => {
        const stack = [
          'Error',
          '    at FrontMcpSkill (/abs/path/sdk/src/common/decorators/skill.decorator.ts:76:21)',
          '    at Object.<anonymous> (/abs/path/sdk/src/skill/__tests__/skill.decorator.spec.ts:50:1)',
        ].join('\n');

        // Spec file must NOT be filtered even though it shares the `skill.decorator` substring.
        expect(parseCallerDir(stack)).toBe('/abs/path/sdk/src/skill/__tests__');
      });

      it('returns undefined when the stack is undefined', () => {
        expect(parseCallerDir(undefined)).toBeUndefined();
      });

      it('returns undefined when no user frames are present', () => {
        const stack = [
          'Error',
          '    at FrontMcpSkill (/abs/path/sdk/src/common/decorators/skill.decorator.ts:76:21)',
          '    at processTicksAndRejections (node:internal/process/task_queues:104:5)',
        ].join('\n');

        expect(parseCallerDir(stack)).toBeUndefined();
      });

      it('caps iteration at 30 frames', () => {
        // Build a 50-frame stack where the only user frame is at frame 35 — past the cap.
        const lines = ['Error'];
        for (let i = 0; i < 50; i++) {
          if (i === 34) {
            lines.push('    at Object.<anonymous> (/abs/path/user/src/late.ts:1:1)');
          } else {
            lines.push('    at internal (/abs/path/node_modules/x/index.js:1:1)');
          }
        }
        expect(parseCallerDir(lines.join('\n'))).toBeUndefined();
      });
    });

    it('should never write a node: internal frame as the caller directory', () => {
      // Regression: the helper used to match frames like
      // `at evaluate (node:internal/process/...)` and return `node:internal/process`,
      // which is not a usable filesystem path.
      @Skill({
        name: 'no-node-internal-skill',
        description: 'Skill whose captured callerDir must not be a node: frame',
        instructions: 'Inline',
      })
      class NoNodeInternalSkill extends MockSkillContext {}

      const dir = Reflect.getMetadata(skillCallerDir, NoNodeInternalSkill) as string | undefined;
      // Either we found a real user-code frame, or we found none. We must never
      // return a node: internal path.
      if (dir !== undefined) {
        expect(dir.startsWith('node:')).toBe(false);
        expect(dir.includes('node_modules')).toBe(false);
      }
      // Either way, decoration always succeeds.
      expect(isSkillDecorated(NoNodeInternalSkill)).toBe(true);
    });
  });
});
