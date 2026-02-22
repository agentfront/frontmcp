/**
 * Skill Metadata Tests
 *
 * Tests for skill metadata types, schemas, and helper functions.
 */

import {
  skillMetadataSchema,
  normalizeToolRef,
  extractToolNames,
  isInlineInstructions,
  isFileInstructions,
  isUrlInstructions,
  SkillMetadata,
  SkillToolRef,
} from '../../common/metadata/skill.metadata';

describe('skill.metadata', () => {
  describe('skillMetadataSchema', () => {
    it('should validate minimal valid metadata', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Step 1: Do something',
      };

      const result = skillMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('test-skill');
        expect(result.data.description).toBe('A test skill');
        expect(result.data.instructions).toBe('Step 1: Do something');
        expect(result.data.priority).toBe(0); // default value
        expect(result.data.hideFromDiscovery).toBe(false); // default value
      }
    });

    it('should validate single-char name', () => {
      const result = skillMetadataSchema.safeParse({
        name: 'a',
        description: 'A skill',
        instructions: 'Do something',
      });
      expect(result.success).toBe(true);
    });

    it('should validate name with numbers', () => {
      const result = skillMetadataSchema.safeParse({
        name: 'skill2go',
        description: 'A skill',
        instructions: 'Do something',
      });
      expect(result.success).toBe(true);
    });

    it('should validate metadata with all fields', () => {
      const metadata: SkillMetadata = {
        id: 'custom-id',
        name: 'full-skill',
        description: 'A fully configured skill',
        instructions: 'Detailed instructions here',
        tools: [{ name: 'tool1', purpose: 'Does thing 1', required: true }, 'tool2'],
        tags: ['tag1', 'tag2'],
        parameters: [{ name: 'param1', description: 'First parameter', required: true, type: 'string' }],
        examples: [{ scenario: 'When user asks X', parameters: { key: 'value' }, expectedOutcome: 'Y happens' }],
        priority: 10,
        hideFromDiscovery: true,
      };

      const result = skillMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('custom-id');
        expect(result.data.priority).toBe(10);
        expect(result.data.hideFromDiscovery).toBe(true);
        expect(result.data.tools).toHaveLength(2);
        expect(result.data.tags).toEqual(['tag1', 'tag2']);
      }
    });

    it('should validate file-based instructions', () => {
      const metadata: SkillMetadata = {
        name: 'file-skill',
        description: 'Skill with file instructions',
        instructions: { file: './skills/my-skill.md' },
      };

      const result = skillMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(true);
    });

    it('should validate URL-based instructions', () => {
      const metadata: SkillMetadata = {
        name: 'url-skill',
        description: 'Skill with URL instructions',
        instructions: { url: 'https://example.com/skills/my-skill.md' },
      };

      const result = skillMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(true);
    });

    it('should reject empty name', () => {
      const metadata = {
        name: '',
        description: 'A skill',
        instructions: 'Do something',
      };

      const result = skillMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(false);
    });

    it('should reject name longer than 64 characters', () => {
      const result = skillMetadataSchema.safeParse({
        name: 'a'.repeat(65),
        description: 'A skill',
        instructions: 'Do something',
      });
      expect(result.success).toBe(false);
    });

    it('should accept name exactly 64 characters', () => {
      const result = skillMetadataSchema.safeParse({
        name: 'a'.repeat(64),
        description: 'A skill',
        instructions: 'Do something',
      });
      expect(result.success).toBe(true);
    });

    it('should reject name with uppercase letters', () => {
      const result = skillMetadataSchema.safeParse({
        name: 'Test-Skill',
        description: 'A skill',
        instructions: 'Do something',
      });
      expect(result.success).toBe(false);
    });

    it('should reject name with underscores', () => {
      const result = skillMetadataSchema.safeParse({
        name: 'test_skill',
        description: 'A skill',
        instructions: 'Do something',
      });
      expect(result.success).toBe(false);
    });

    it('should reject name with spaces', () => {
      const result = skillMetadataSchema.safeParse({
        name: 'test skill',
        description: 'A skill',
        instructions: 'Do something',
      });
      expect(result.success).toBe(false);
    });

    it('should reject name starting with a hyphen', () => {
      const result = skillMetadataSchema.safeParse({
        name: '-test-skill',
        description: 'A skill',
        instructions: 'Do something',
      });
      expect(result.success).toBe(false);
    });

    it('should reject name ending with a hyphen', () => {
      const result = skillMetadataSchema.safeParse({
        name: 'test-skill-',
        description: 'A skill',
        instructions: 'Do something',
      });
      expect(result.success).toBe(false);
    });

    it('should reject name with consecutive hyphens', () => {
      const result = skillMetadataSchema.safeParse({
        name: 'test--skill',
        description: 'A skill',
        instructions: 'Do something',
      });
      expect(result.success).toBe(false);
    });

    it('should reject description longer than 1024 characters', () => {
      const result = skillMetadataSchema.safeParse({
        name: 'test-skill',
        description: 'a'.repeat(1025),
        instructions: 'Do something',
      });
      expect(result.success).toBe(false);
    });

    it('should accept description exactly 1024 characters', () => {
      const result = skillMetadataSchema.safeParse({
        name: 'test-skill',
        description: 'a'.repeat(1024),
        instructions: 'Do something',
      });
      expect(result.success).toBe(true);
    });

    it('should reject description with XML tags', () => {
      const result = skillMetadataSchema.safeParse({
        name: 'test-skill',
        description: 'A skill with <b>bold</b> text',
        instructions: 'Do something',
      });
      expect(result.success).toBe(false);
    });

    it('should reject description with XML self-closing tags', () => {
      const result = skillMetadataSchema.safeParse({
        name: 'test-skill',
        description: 'A skill with <br/> break',
        instructions: 'Do something',
      });
      expect(result.success).toBe(false);
    });

    it('should accept description with angle brackets that are not tags', () => {
      const result = skillMetadataSchema.safeParse({
        name: 'test-skill',
        description: 'A skill that checks x < y and x > 0',
        instructions: 'Do something',
      });
      expect(result.success).toBe(true);
    });

    it('should validate new spec fields (license, compatibility, specMetadata, allowedTools, resources)', () => {
      const metadata: SkillMetadata = {
        name: 'spec-skill',
        description: 'A spec-compliant skill',
        instructions: 'Do something',
        license: 'MIT',
        compatibility: 'Requires Node.js 18+',
        specMetadata: { author: 'test', version: '1.0' },
        allowedTools: 'Read Edit Bash(git status)',
        resources: {
          scripts: '/path/to/scripts',
          references: '/path/to/references',
          assets: '/path/to/assets',
        },
      };

      const result = skillMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.license).toBe('MIT');
        expect(result.data.compatibility).toBe('Requires Node.js 18+');
        expect(result.data.specMetadata).toEqual({ author: 'test', version: '1.0' });
        expect(result.data.allowedTools).toBe('Read Edit Bash(git status)');
        expect(result.data.resources).toEqual({
          scripts: '/path/to/scripts',
          references: '/path/to/references',
          assets: '/path/to/assets',
        });
      }
    });

    it('should reject compatibility longer than 500 characters', () => {
      const result = skillMetadataSchema.safeParse({
        name: 'test-skill',
        description: 'A skill',
        instructions: 'Do something',
        compatibility: 'a'.repeat(501),
      });
      expect(result.success).toBe(false);
    });

    it('should accept partial resources', () => {
      const result = skillMetadataSchema.safeParse({
        name: 'test-skill',
        description: 'A skill',
        instructions: 'Do something',
        resources: { scripts: '/scripts' },
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty description', () => {
      const metadata = {
        name: 'test-skill',
        description: '',
        instructions: 'Do something',
      };

      const result = skillMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(false);
    });

    it('should reject missing instructions', () => {
      const metadata = {
        name: 'test-skill',
        description: 'A skill',
      };

      const result = skillMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(false);
    });

    it('should reject invalid URL in instructions', () => {
      const metadata = {
        name: 'test-skill',
        description: 'A skill',
        instructions: { url: 'not-a-valid-url' },
      };

      const result = skillMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(false);
    });

    it('should validate parameter types', () => {
      const validTypes = ['string', 'number', 'boolean', 'object', 'array'];

      for (const type of validTypes) {
        const metadata = {
          name: 'test-skill',
          description: 'A skill',
          instructions: 'Do something',
          parameters: [{ name: 'param', type }],
        };

        const result = skillMetadataSchema.safeParse(metadata);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('normalizeToolRef', () => {
    it('should normalize string to SkillToolRef', () => {
      const result = normalizeToolRef('my-tool');
      expect(result).toEqual({ name: 'my-tool', required: false });
    });

    it('should return SkillToolRef as-is with defaults', () => {
      const ref: SkillToolRef = { name: 'my-tool', purpose: 'Does something' };
      const result = normalizeToolRef(ref);
      expect(result).toEqual({ name: 'my-tool', purpose: 'Does something', required: false });
    });

    it('should preserve required flag', () => {
      const ref: SkillToolRef = { name: 'my-tool', required: true };
      const result = normalizeToolRef(ref);
      expect(result.required).toBe(true);
    });
  });

  describe('extractToolNames', () => {
    it('should extract names from mixed tool references', () => {
      const metadata: SkillMetadata = {
        name: 'test',
        description: 'test',
        instructions: 'test',
        tools: ['tool1', { name: 'tool2', purpose: 'Does something' }, { name: 'tool3', required: true }],
      };

      const names = extractToolNames(metadata);
      expect(names).toEqual(['tool1', 'tool2', 'tool3']);
    });

    it('should return empty array when no tools', () => {
      const metadata: SkillMetadata = {
        name: 'test',
        description: 'test',
        instructions: 'test',
      };

      const names = extractToolNames(metadata);
      expect(names).toEqual([]);
    });
  });

  describe('instruction source type guards', () => {
    describe('isInlineInstructions', () => {
      it('should return true for string', () => {
        expect(isInlineInstructions('inline instructions')).toBe(true);
      });

      it('should return false for file source', () => {
        expect(isInlineInstructions({ file: './path.md' })).toBe(false);
      });

      it('should return false for URL source', () => {
        expect(isInlineInstructions({ url: 'https://example.com' })).toBe(false);
      });
    });

    describe('isFileInstructions', () => {
      it('should return true for file source', () => {
        expect(isFileInstructions({ file: './path.md' })).toBe(true);
      });

      it('should return false for string', () => {
        expect(isFileInstructions('inline instructions')).toBe(false);
      });

      it('should return false for URL source', () => {
        expect(isFileInstructions({ url: 'https://example.com' })).toBe(false);
      });
    });

    describe('isUrlInstructions', () => {
      it('should return true for URL source', () => {
        expect(isUrlInstructions({ url: 'https://example.com' })).toBe(true);
      });

      it('should return false for string', () => {
        expect(isUrlInstructions('inline instructions')).toBe(false);
      });

      it('should return false for file source', () => {
        expect(isUrlInstructions({ file: './path.md' })).toBe(false);
      });
    });
  });
});
