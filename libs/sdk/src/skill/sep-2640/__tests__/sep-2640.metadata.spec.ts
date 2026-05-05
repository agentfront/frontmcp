/**
 * SEP-2640 metadata schema conformance tests.
 *
 * Verifies the `skillPath` field validation:
 *   - final segment MUST equal `name`
 *   - prefix segments must be RFC 3986 path segments
 */

import 'reflect-metadata';

import { skillMetadataSchema } from '../../../common/metadata/skill.metadata';

describe('skillMetadataSchema — SEP-2640 path/name binding', () => {
  const baseSkill = {
    name: 'refunds',
    description: 'Refund handling',
    instructions: 'Step 1...',
  };

  it('accepts a metadata without skillPath (flat)', () => {
    const result = skillMetadataSchema.safeParse(baseSkill);
    expect(result.success).toBe(true);
  });

  it('accepts skillPath whose final segment equals name', () => {
    const result = skillMetadataSchema.safeParse({
      ...baseSkill,
      skillPath: ['acme', 'billing', 'refunds'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects skillPath whose final segment differs from name', () => {
    const result = skillMetadataSchema.safeParse({
      ...baseSkill,
      skillPath: ['acme', 'billing', 'returns'],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /must equal name/.test(i.message))).toBe(true);
    }
  });

  it('rejects skillPath that is the empty array (array-level .min(1))', () => {
    const result = skillMetadataSchema.safeParse({
      ...baseSkill,
      skillPath: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects skillPath containing an empty segment (per-element .min(1))', () => {
    const result = skillMetadataSchema.safeParse({
      ...baseSkill,
      skillPath: [''],
    });
    expect(result.success).toBe(false);
  });

  it('rejects skillPath with disallowed characters', () => {
    const result = skillMetadataSchema.safeParse({
      ...baseSkill,
      skillPath: ['acme', 'billing space', 'refunds'],
    });
    expect(result.success).toBe(false);
  });

  it('still rejects names that violate Agent Skills naming rules', () => {
    const result = skillMetadataSchema.safeParse({
      name: 'Bad-Name',
      description: 'd',
      instructions: 'x',
    });
    expect(result.success).toBe(false);
  });
});
