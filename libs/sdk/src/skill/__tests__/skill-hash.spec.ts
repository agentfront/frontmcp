/**
 * Skill Hash Tests
 *
 * Tests for deterministic skill content hashing used in change detection.
 */

import { computeSkillHash, computeSkillHashComponents, areSkillsEqual } from '../sync/skill-hash';
import type { SkillContent } from '../../common/interfaces';

// Helper to create test skills
const createTestSkill = (overrides: Partial<SkillContent> = {}): SkillContent => ({
  id: 'test-skill',
  name: 'Test Skill',
  description: 'A test skill for testing',
  instructions: 'Step 1: Do something\nStep 2: Do another thing',
  tools: [{ name: 'tool1' }, { name: 'tool2', purpose: 'Does something' }],
  ...overrides,
});

describe('skill-hash', () => {
  describe('computeSkillHash', () => {
    it('should produce consistent hash for same content', () => {
      const skill = createTestSkill();

      const hash1 = computeSkillHash(skill);
      const hash2 = computeSkillHash(skill);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex format
    });

    it('should produce different hash for different content', () => {
      const skill1 = createTestSkill({ id: 'skill-1' });
      const skill2 = createTestSkill({ id: 'skill-2' });

      const hash1 = computeSkillHash(skill1);
      const hash2 = computeSkillHash(skill2);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hash when instructions change', () => {
      const skill1 = createTestSkill({ instructions: 'Original instructions' });
      const skill2 = createTestSkill({ instructions: 'Modified instructions' });

      const hash1 = computeSkillHash(skill1);
      const hash2 = computeSkillHash(skill2);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hash when description changes', () => {
      const skill1 = createTestSkill({ description: 'Description A' });
      const skill2 = createTestSkill({ description: 'Description B' });

      const hash1 = computeSkillHash(skill1);
      const hash2 = computeSkillHash(skill2);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hash when tools change', () => {
      const skill1 = createTestSkill({ tools: [{ name: 'tool1' }] });
      const skill2 = createTestSkill({ tools: [{ name: 'tool2' }] });

      const hash1 = computeSkillHash(skill1);
      const hash2 = computeSkillHash(skill2);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce same hash regardless of tool order', () => {
      const skill1 = createTestSkill({
        tools: [{ name: 'tool-a' }, { name: 'tool-b' }, { name: 'tool-c' }],
      });
      const skill2 = createTestSkill({
        tools: [{ name: 'tool-c' }, { name: 'tool-a' }, { name: 'tool-b' }],
      });

      const hash1 = computeSkillHash(skill1);
      const hash2 = computeSkillHash(skill2);

      expect(hash1).toBe(hash2);
    });

    it('should include parameters in hash', () => {
      const skill1 = createTestSkill({
        parameters: [{ name: 'param1', description: 'First param' }],
      });
      const skill2 = createTestSkill({
        parameters: [{ name: 'param2', description: 'Different param' }],
      });

      const hash1 = computeSkillHash(skill1);
      const hash2 = computeSkillHash(skill2);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce same hash regardless of parameter order', () => {
      const skill1 = createTestSkill({
        parameters: [
          { name: 'param-a', description: 'A' },
          { name: 'param-b', description: 'B' },
        ],
      });
      const skill2 = createTestSkill({
        parameters: [
          { name: 'param-b', description: 'B' },
          { name: 'param-a', description: 'A' },
        ],
      });

      const hash1 = computeSkillHash(skill1);
      const hash2 = computeSkillHash(skill2);

      expect(hash1).toBe(hash2);
    });

    it('should include examples in hash', () => {
      const skill1 = createTestSkill({
        examples: [{ scenario: 'When X happens', expectedOutcome: 'Do Y' }],
      });
      const skill2 = createTestSkill({
        examples: [{ scenario: 'When A happens', expectedOutcome: 'Do B' }],
      });

      const hash1 = computeSkillHash(skill1);
      const hash2 = computeSkillHash(skill2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle skills without optional fields', () => {
      const minimalSkill: SkillContent = {
        id: 'minimal',
        name: 'Minimal Skill',
        description: 'A minimal skill',
        instructions: 'Do something',
        tools: [],
      };

      const hash = computeSkillHash(minimalSkill);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('computeSkillHashComponents', () => {
    it('should compute all hash components', () => {
      const skill = createTestSkill();

      const components = computeSkillHashComponents(skill);

      expect(components.instructionsHash).toMatch(/^[a-f0-9]{64}$/);
      expect(components.toolsHash).toMatch(/^[a-f0-9]{64}$/);
      expect(components.metadataHash).toMatch(/^[a-f0-9]{64}$/);
      expect(components.combinedHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce different instructionsHash when instructions change', () => {
      const skill1 = createTestSkill({ instructions: 'Original' });
      const skill2 = createTestSkill({ instructions: 'Modified' });

      const components1 = computeSkillHashComponents(skill1);
      const components2 = computeSkillHashComponents(skill2);

      expect(components1.instructionsHash).not.toBe(components2.instructionsHash);
      expect(components1.toolsHash).toBe(components2.toolsHash); // Tools unchanged
      expect(components1.metadataHash).toBe(components2.metadataHash); // Metadata unchanged
    });

    it('should produce different toolsHash when tools change', () => {
      const skill1 = createTestSkill({ tools: [{ name: 'tool1' }] });
      const skill2 = createTestSkill({ tools: [{ name: 'tool2' }] });

      const components1 = computeSkillHashComponents(skill1);
      const components2 = computeSkillHashComponents(skill2);

      expect(components1.toolsHash).not.toBe(components2.toolsHash);
      expect(components1.instructionsHash).toBe(components2.instructionsHash); // Instructions unchanged
    });

    it('should produce different metadataHash when metadata changes', () => {
      const skill1 = createTestSkill({ name: 'Skill A' });
      const skill2 = createTestSkill({ name: 'Skill B' });

      const components1 = computeSkillHashComponents(skill1);
      const components2 = computeSkillHashComponents(skill2);

      expect(components1.metadataHash).not.toBe(components2.metadataHash);
      expect(components1.instructionsHash).toBe(components2.instructionsHash); // Instructions unchanged
    });

    it('should combine all components into combinedHash', () => {
      const skill = createTestSkill();

      const components1 = computeSkillHashComponents(skill);
      const components2 = computeSkillHashComponents(skill);

      // Same skill should produce same combined hash
      expect(components1.combinedHash).toBe(components2.combinedHash);
    });
  });

  describe('areSkillsEqual', () => {
    it('should return true for identical skills', () => {
      const skill1 = createTestSkill();
      const skill2 = createTestSkill();

      expect(areSkillsEqual(skill1, skill2)).toBe(true);
    });

    it('should return false for different skills', () => {
      const skill1 = createTestSkill({ id: 'skill-1' });
      const skill2 = createTestSkill({ id: 'skill-2' });

      expect(areSkillsEqual(skill1, skill2)).toBe(false);
    });

    it('should return true for skills with same content but different tool order', () => {
      const skill1 = createTestSkill({
        tools: [{ name: 'tool-a' }, { name: 'tool-b' }],
      });
      const skill2 = createTestSkill({
        tools: [{ name: 'tool-b' }, { name: 'tool-a' }],
      });

      expect(areSkillsEqual(skill1, skill2)).toBe(true);
    });

    it('should return false when tool count differs', () => {
      const skill1 = createTestSkill({
        tools: [{ name: 'tool1' }],
      });
      const skill2 = createTestSkill({
        tools: [{ name: 'tool1' }, { name: 'tool2' }],
      });

      expect(areSkillsEqual(skill1, skill2)).toBe(false);
    });
  });
});
