/**
 * Skill Utils Tests
 *
 * Tests for skill utility functions.
 */

import 'reflect-metadata';
import {
  normalizeSkill,
  isSkillRecord,
  skillDiscoveryDeps,
  buildSkillContent,
  formatSkillForLLM,
} from '../skill.utils';
import { SkillKind, SkillMetadata, SkillContext, SkillContent } from '../../common';
import { Skill, skill } from '../../common/decorators/skill.decorator';

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

describe('skill.utils', () => {
  describe('normalizeSkill', () => {
    it('should normalize a class with @Skill decorator', () => {
      @Skill({
        name: 'class-skill',
        description: 'A class-based skill',
        instructions: 'Do something',
      })
      class ClassSkill extends MockSkillContext {}

      const result = normalizeSkill(ClassSkill);

      expect(result.kind).toBe(SkillKind.CLASS_TOKEN);
      expect(result.provide).toBe(ClassSkill);
      expect(result.metadata.name).toBe('class-skill');
    });

    it('should passthrough SkillValueRecord from skill() helper', () => {
      const valueRecord = skill({
        name: 'value-skill',
        description: 'A value-based skill',
        instructions: 'Do something inline',
      });

      const result = normalizeSkill(valueRecord);

      expect(result).toBe(valueRecord);
      expect(result.kind).toBe(SkillKind.VALUE);
      expect(result.metadata.name).toBe('value-skill');
    });

    it('should passthrough SkillFileRecord', () => {
      const fileRecord = {
        kind: SkillKind.FILE,
        provide: Symbol('file-skill'),
        metadata: {
          name: 'file-skill',
          description: 'A file-based skill',
          instructions: { file: './skills/test.md' },
        } as SkillMetadata,
        filePath: './skills/test.skill.md',
      };

      const result = normalizeSkill(fileRecord);

      expect(result).toBe(fileRecord);
    });

    it('should throw for class without @Skill decorator', () => {
      class PlainClass {}

      expect(() => normalizeSkill(PlainClass)).toThrow();
    });

    it('should throw for invalid input', () => {
      expect(() => normalizeSkill({ foo: 'bar' })).toThrow();
      expect(() => normalizeSkill('string')).toThrow();
      expect(() => normalizeSkill(123)).toThrow();
      expect(() => normalizeSkill(null)).toThrow();
      expect(() => normalizeSkill(undefined)).toThrow();
    });
  });

  describe('isSkillRecord', () => {
    it('should return true for SkillClassTokenRecord', () => {
      @Skill({
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Do something',
      })
      class TestSkill extends MockSkillContext {}

      const record = normalizeSkill(TestSkill);
      expect(isSkillRecord(record)).toBe(true);
    });

    it('should return true for SkillValueRecord', () => {
      const record = skill({
        name: 'value-skill',
        description: 'A value skill',
        instructions: 'Do something',
      });

      expect(isSkillRecord(record)).toBe(true);
    });

    it('should return true for SkillFileRecord', () => {
      const record = {
        kind: SkillKind.FILE,
        provide: Symbol('file-skill'),
        metadata: {
          name: 'file-skill',
          description: 'A file skill',
          instructions: { file: './test.md' },
        } as SkillMetadata,
        filePath: './test.skill.md',
      };

      expect(isSkillRecord(record)).toBe(true);
    });

    it('should return false for non-objects', () => {
      expect(isSkillRecord(null)).toBe(false);
      expect(isSkillRecord(undefined)).toBe(false);
      expect(isSkillRecord('string')).toBe(false);
      expect(isSkillRecord(123)).toBe(false);
    });

    it('should return false for objects without kind', () => {
      expect(isSkillRecord({ provide: {}, metadata: {} })).toBe(false);
    });

    it('should return false for invalid kind', () => {
      expect(isSkillRecord({ kind: 'INVALID', provide: {}, metadata: {} })).toBe(false);
    });

    it('should return false for missing provide or metadata', () => {
      expect(isSkillRecord({ kind: SkillKind.VALUE, provide: {} })).toBe(false);
      expect(isSkillRecord({ kind: SkillKind.VALUE, metadata: {} })).toBe(false);
    });
  });

  describe('skillDiscoveryDeps', () => {
    it('should return empty array for VALUE records', () => {
      const record = skill({
        name: 'value-skill',
        description: 'A value skill',
        instructions: 'Do something',
      });

      expect(skillDiscoveryDeps(record)).toEqual([]);
    });

    it('should return empty array for FILE records', () => {
      const record = {
        kind: SkillKind.FILE as const,
        provide: Symbol('file-skill'),
        metadata: {
          name: 'file-skill',
          description: 'A file skill',
          instructions: { file: './test.md' },
        } as SkillMetadata,
        filePath: './test.skill.md',
      };

      expect(skillDiscoveryDeps(record)).toEqual([]);
    });

    it('should return class dependencies for CLASS_TOKEN records', () => {
      @Skill({
        name: 'class-skill',
        description: 'A class skill',
        instructions: 'Do something',
      })
      class ClassSkill extends MockSkillContext {}

      const record = normalizeSkill(ClassSkill);
      const deps = skillDiscoveryDeps(record);

      // Class dependencies depend on the class, but should be an array
      expect(Array.isArray(deps)).toBe(true);
    });
  });

  describe('buildSkillContent', () => {
    it('should build content from metadata and instructions', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Ignored (resolved instruction used)',
        tools: ['tool1', { name: 'tool2', purpose: 'Does something' }],
        tags: ['test'],
      };

      const content = buildSkillContent(metadata, 'Resolved instructions here');

      expect(content.id).toBe('test-skill');
      expect(content.name).toBe('test-skill');
      expect(content.description).toBe('A test skill');
      expect(content.instructions).toBe('Resolved instructions here');
      expect(content.tools).toEqual([
        { name: 'tool1', purpose: undefined, required: false },
        { name: 'tool2', purpose: 'Does something', required: false },
      ]);
    });

    it('should use custom id if provided', () => {
      const metadata: SkillMetadata = {
        id: 'custom-id',
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'ignored',
      };

      const content = buildSkillContent(metadata, 'Instructions');

      expect(content.id).toBe('custom-id');
      expect(content.name).toBe('test-skill');
    });

    it('should include parameters when present', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'ignored',
        parameters: [{ name: 'param1', description: 'First param', required: true }, { name: 'param2' }],
      };

      const content = buildSkillContent(metadata, 'Instructions');

      expect(content.parameters).toEqual([
        { name: 'param1', description: 'First param', required: true },
        { name: 'param2' },
      ]);
    });

    it('should include examples when present', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'ignored',
        examples: [{ scenario: 'When user asks X', expectedOutcome: 'Y happens' }],
      };

      const content = buildSkillContent(metadata, 'Instructions');

      expect(content.examples).toEqual([{ scenario: 'When user asks X', expectedOutcome: 'Y happens' }]);
    });

    it('should handle empty tools array', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'ignored',
      };

      const content = buildSkillContent(metadata, 'Instructions');

      expect(content.tools).toEqual([]);
    });

    /**
     * Issue #5: Required tool semantics
     *
     * The buildSkillContent function should preserve the required flag on tools.
     * This ensures that skill sessions can track which tools are mandatory for
     * the skill to function correctly.
     */
    it('should preserve required flag on tools', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'ignored',
        tools: [
          'simple-tool',
          { name: 'required-tool', required: true },
          { name: 'optional-tool', required: false },
          { name: 'default-tool' }, // No required flag defaults to false
        ],
      };

      const content = buildSkillContent(metadata, 'Instructions');

      expect(content.tools).toEqual([
        { name: 'simple-tool', purpose: undefined, required: false },
        { name: 'required-tool', purpose: undefined, required: true },
        { name: 'optional-tool', purpose: undefined, required: false },
        { name: 'default-tool', purpose: undefined, required: false },
      ]);
    });

    it('should preserve required flag with purpose', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'ignored',
        tools: [
          { name: 'required-with-purpose', purpose: 'Critical operation', required: true },
          { name: 'optional-with-purpose', purpose: 'Optional operation', required: false },
        ],
      };

      const content = buildSkillContent(metadata, 'Instructions');

      expect(content.tools).toEqual([
        { name: 'required-with-purpose', purpose: 'Critical operation', required: true },
        { name: 'optional-with-purpose', purpose: 'Optional operation', required: false },
      ]);
    });

    it('should include new spec fields in content', () => {
      const metadata: SkillMetadata = {
        name: 'spec-skill',
        description: 'A spec skill',
        instructions: 'ignored',
        license: 'MIT',
        compatibility: 'Node.js 18+',
        specMetadata: { author: 'test' },
        allowedTools: 'Read Edit',
        resources: { scripts: '/path/scripts' },
      };

      const content = buildSkillContent(metadata, 'Instructions');

      expect(content.license).toBe('MIT');
      expect(content.compatibility).toBe('Node.js 18+');
      expect(content.specMetadata).toEqual({ author: 'test' });
      expect(content.allowedTools).toBe('Read Edit');
      expect(content.resources).toEqual({ scripts: '/path/scripts' });
    });

    it('should leave new spec fields undefined when not set', () => {
      const metadata: SkillMetadata = {
        name: 'basic-skill',
        description: 'A basic skill',
        instructions: 'ignored',
      };

      const content = buildSkillContent(metadata, 'Instructions');

      expect(content.license).toBeUndefined();
      expect(content.compatibility).toBeUndefined();
      expect(content.specMetadata).toBeUndefined();
      expect(content.allowedTools).toBeUndefined();
      expect(content.resources).toBeUndefined();
    });
  });

  describe('formatSkillForLLM', () => {
    it('should format skill with all tools available', () => {
      const skill: SkillContent = {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill for testing',
        instructions: 'Step 1: Do this\nStep 2: Do that',
        tools: [{ name: 'tool1', purpose: 'Does thing 1' }, { name: 'tool2' }],
      };

      const result = formatSkillForLLM(skill, ['tool1', 'tool2'], []);

      expect(result).toContain('# Skill: Test Skill');
      expect(result).toContain('A test skill for testing');
      expect(result).toContain('[✓] `tool1` - Does thing 1');
      expect(result).toContain('[✓] `tool2`');
      expect(result).toContain('Step 1: Do this');
      expect(result).toContain('Step 2: Do that');
      expect(result).not.toContain('Warning');
    });

    it('should include warning for missing tools', () => {
      const skill: SkillContent = {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill',
        instructions: 'Instructions',
        tools: [{ name: 'available-tool' }, { name: 'missing-tool' }],
      };

      const result = formatSkillForLLM(skill, ['available-tool'], ['missing-tool']);

      expect(result).toContain('Warning');
      expect(result).toContain('missing-tool');
      expect(result).toContain('[✓] `available-tool`');
      expect(result).toContain('[✗] `missing-tool`');
    });

    it('should include parameters section', () => {
      const skill: SkillContent = {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill',
        instructions: 'Instructions',
        tools: [],
        parameters: [{ name: 'param1', description: 'First param', required: true }, { name: 'param2' }],
      };

      const result = formatSkillForLLM(skill, [], []);

      expect(result).toContain('## Parameters');
      expect(result).toContain('**param1** (required): First param');
      expect(result).toContain('**param2**');
    });

    it('should include examples section', () => {
      const skill: SkillContent = {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill',
        instructions: 'Instructions',
        tools: [],
        examples: [
          { scenario: 'When user asks about X', expectedOutcome: 'Explain Y' },
          { scenario: 'Another scenario' },
        ],
      };

      const result = formatSkillForLLM(skill, [], []);

      expect(result).toContain('## Examples');
      expect(result).toContain('### When user asks about X');
      expect(result).toContain('Expected outcome: Explain Y');
      expect(result).toContain('### Another scenario');
    });

    it('should omit tools section when no tools', () => {
      const skill: SkillContent = {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill',
        instructions: 'Instructions',
        tools: [],
      };

      const result = formatSkillForLLM(skill, [], []);

      expect(result).not.toContain('## Tools');
    });

    it('should omit parameters section when no parameters', () => {
      const skill: SkillContent = {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill',
        instructions: 'Instructions',
        tools: [],
      };

      const result = formatSkillForLLM(skill, [], []);

      expect(result).not.toContain('## Parameters');
    });

    it('should omit examples section when no examples', () => {
      const skill: SkillContent = {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill',
        instructions: 'Instructions',
        tools: [],
      };

      const result = formatSkillForLLM(skill, [], []);

      expect(result).not.toContain('## Examples');
    });

    it('should include license when present', () => {
      const skill: SkillContent = {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill',
        instructions: 'Instructions',
        tools: [],
        license: 'MIT',
      };

      const result = formatSkillForLLM(skill, [], []);

      expect(result).toContain('**License:** MIT');
    });

    it('should include compatibility when present', () => {
      const skill: SkillContent = {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill',
        instructions: 'Instructions',
        tools: [],
        compatibility: 'Requires Node.js 18+',
      };

      const result = formatSkillForLLM(skill, [], []);

      expect(result).toContain('**Compatibility:** Requires Node.js 18+');
    });

    it('should not include license/compatibility when not set', () => {
      const skill: SkillContent = {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill',
        instructions: 'Instructions',
        tools: [],
      };

      const result = formatSkillForLLM(skill, [], []);

      expect(result).not.toContain('**License:**');
      expect(result).not.toContain('**Compatibility:**');
    });
  });
});
