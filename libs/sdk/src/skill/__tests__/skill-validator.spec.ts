/**
 * Skill Validator Tests
 *
 * Tests for SkillToolValidator which validates tool availability for skills.
 */

import { SkillToolValidator, ToolValidationResult } from '../skill-validator';
import { ToolRegistryInterface } from '../../common/interfaces/internal';
import { ToolEntry } from '../../common';

// Mock tool entries for testing
const createMockTool = (name: string, hidden = false): ToolEntry =>
  ({
    name,
    metadata: {
      name,
      description: `Tool ${name}`,
      inputSchema: {},
      outputSchema: {},
      hideFromDiscovery: hidden,
    },
    isHidden: () => hidden,
  }) as unknown as ToolEntry;

// Create a mock tool registry
const createMockToolRegistry = (visibleTools: string[], hiddenTools: string[] = []): ToolRegistryInterface => {
  const allToolList: ToolEntry[] = [
    ...visibleTools.map((name) => createMockTool(name, false)),
    ...hiddenTools.map((name) => createMockTool(name, true)),
  ];

  const visibleToolList: ToolEntry[] = visibleTools.map((name) => createMockTool(name, false));

  return {
    getTools: (includeHidden?: boolean) => (includeHidden ? allToolList : visibleToolList),
    findByName: jest.fn(),
    findByQualifiedName: jest.fn(),
    hasAny: jest.fn(),
    subscribe: jest.fn(),
    getCapabilities: jest.fn(),
    getInlineTools: jest.fn(),
    owner: { kind: 'scope', id: 'test', ref: {} },
  } as unknown as ToolRegistryInterface;
};

describe('skill-validator', () => {
  describe('SkillToolValidator', () => {
    describe('validate', () => {
      it('should return all tools as available when all exist', () => {
        const registry = createMockToolRegistry(['tool1', 'tool2', 'tool3']);
        const validator = new SkillToolValidator(registry);

        const result = validator.validate(['tool1', 'tool2', 'tool3']);

        expect(result.available).toEqual(['tool1', 'tool2', 'tool3']);
        expect(result.missing).toEqual([]);
        expect(result.hidden).toEqual([]);
        expect(result.complete).toBe(true);
      });

      it('should identify missing tools', () => {
        const registry = createMockToolRegistry(['tool1', 'tool2']);
        const validator = new SkillToolValidator(registry);

        const result = validator.validate(['tool1', 'tool2', 'missing-tool']);

        expect(result.available).toEqual(['tool1', 'tool2']);
        expect(result.missing).toEqual(['missing-tool']);
        expect(result.hidden).toEqual([]);
        expect(result.complete).toBe(false);
      });

      it('should identify hidden tools', () => {
        const registry = createMockToolRegistry(['tool1'], ['hidden-tool']);
        const validator = new SkillToolValidator(registry);

        const result = validator.validate(['tool1', 'hidden-tool']);

        expect(result.available).toEqual(['tool1']);
        expect(result.missing).toEqual([]);
        expect(result.hidden).toEqual(['hidden-tool']);
        // Hidden tools don't affect completeness (only missing tools do)
        expect(result.complete).toBe(true);
      });

      it('should handle mix of available, missing, and hidden tools', () => {
        const registry = createMockToolRegistry(['tool1', 'tool2'], ['hidden-tool']);
        const validator = new SkillToolValidator(registry);

        const result = validator.validate(['tool1', 'tool2', 'hidden-tool', 'missing-tool']);

        expect(result.available).toEqual(['tool1', 'tool2']);
        expect(result.missing).toEqual(['missing-tool']);
        expect(result.hidden).toEqual(['hidden-tool']);
        expect(result.complete).toBe(false);
      });

      it('should return complete=true for empty tool list', () => {
        const registry = createMockToolRegistry(['tool1', 'tool2']);
        const validator = new SkillToolValidator(registry);

        const result = validator.validate([]);

        expect(result.available).toEqual([]);
        expect(result.missing).toEqual([]);
        expect(result.hidden).toEqual([]);
        expect(result.complete).toBe(true);
      });

      it('should check required tools for completeness', () => {
        const registry = createMockToolRegistry(['tool1', 'tool2']);
        const validator = new SkillToolValidator(registry);
        const requiredTools = new Set(['tool1', 'tool3']);

        const result = validator.validate(['tool1', 'tool2', 'tool3'], requiredTools);

        // tool3 is missing, and it's required
        expect(result.complete).toBe(false);
      });

      it('should be complete if all required tools are available', () => {
        const registry = createMockToolRegistry(['tool1', 'tool2', 'tool3']);
        const validator = new SkillToolValidator(registry);
        const requiredTools = new Set(['tool1', 'tool2']);

        const result = validator.validate(['tool1', 'tool2', 'tool3'], requiredTools);

        expect(result.complete).toBe(true);
      });

      it('should consider hidden required tools as incomplete', () => {
        const registry = createMockToolRegistry(['tool1'], ['required-hidden']);
        const validator = new SkillToolValidator(registry);
        const requiredTools = new Set(['required-hidden']);

        const result = validator.validate(['tool1', 'required-hidden'], requiredTools);

        expect(result.complete).toBe(false);
      });
    });

    describe('formatWarning', () => {
      it('should return undefined when no issues', () => {
        const registry = createMockToolRegistry(['tool1', 'tool2']);
        const validator = new SkillToolValidator(registry);

        const result: ToolValidationResult = {
          available: ['tool1', 'tool2'],
          missing: [],
          hidden: [],
          complete: true,
        };

        expect(validator.formatWarning(result, 'test-skill')).toBeUndefined();
      });

      it('should format warning for missing tools', () => {
        const registry = createMockToolRegistry(['tool1']);
        const validator = new SkillToolValidator(registry);

        const result: ToolValidationResult = {
          available: ['tool1'],
          missing: ['missing1', 'missing2'],
          hidden: [],
          complete: false,
        };

        const warning = validator.formatWarning(result, 'test-skill');
        expect(warning).toContain('test-skill');
        expect(warning).toContain('missing tools');
        expect(warning).toContain('missing1, missing2');
      });

      it('should format warning for hidden tools', () => {
        const registry = createMockToolRegistry(['tool1']);
        const validator = new SkillToolValidator(registry);

        const result: ToolValidationResult = {
          available: ['tool1'],
          missing: [],
          hidden: ['hidden1'],
          complete: false,
        };

        const warning = validator.formatWarning(result, 'test-skill');
        expect(warning).toContain('test-skill');
        expect(warning).toContain('hidden tools');
        expect(warning).toContain('hidden1');
      });

      it('should format warning for both missing and hidden tools', () => {
        const registry = createMockToolRegistry(['tool1']);
        const validator = new SkillToolValidator(registry);

        const result: ToolValidationResult = {
          available: ['tool1'],
          missing: ['missing1'],
          hidden: ['hidden1'],
          complete: false,
        };

        const warning = validator.formatWarning(result, 'test-skill');
        expect(warning).toContain('missing tools');
        expect(warning).toContain('hidden tools');
        expect(warning).toContain('missing1');
        expect(warning).toContain('hidden1');
      });
    });

    describe('isToolAvailable', () => {
      it('should return true for visible tools', () => {
        const registry = createMockToolRegistry(['tool1', 'tool2']);
        const validator = new SkillToolValidator(registry);

        expect(validator.isToolAvailable('tool1')).toBe(true);
        expect(validator.isToolAvailable('tool2')).toBe(true);
      });

      it('should return false for hidden tools', () => {
        const registry = createMockToolRegistry(['tool1'], ['hidden-tool']);
        const validator = new SkillToolValidator(registry);

        expect(validator.isToolAvailable('hidden-tool')).toBe(false);
      });

      it('should return false for non-existent tools', () => {
        const registry = createMockToolRegistry(['tool1']);
        const validator = new SkillToolValidator(registry);

        expect(validator.isToolAvailable('non-existent')).toBe(false);
      });
    });

    describe('toolExists', () => {
      it('should return true for visible tools', () => {
        const registry = createMockToolRegistry(['tool1']);
        const validator = new SkillToolValidator(registry);

        expect(validator.toolExists('tool1')).toBe(true);
      });

      it('should return true for hidden tools', () => {
        const registry = createMockToolRegistry(['tool1'], ['hidden-tool']);
        const validator = new SkillToolValidator(registry);

        expect(validator.toolExists('hidden-tool')).toBe(true);
      });

      it('should return false for non-existent tools', () => {
        const registry = createMockToolRegistry(['tool1']);
        const validator = new SkillToolValidator(registry);

        expect(validator.toolExists('non-existent')).toBe(false);
      });
    });
  });
});
