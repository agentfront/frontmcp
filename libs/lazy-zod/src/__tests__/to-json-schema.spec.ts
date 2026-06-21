import { toJSONSchema, z } from '../index';

// Regression guard for the lazy-Proxy ↔ zod `toJSONSchema` interaction.
//
// zod's converter walks and MUTATES the schema tree via internal `_def` nodes
// (it writes a `ref` onto each visited node). A lazy-zod Proxy in any nested
// position — a `z.union([...])` option, an `.optional()` inner type, an array
// element — used to break those writes with:
//   "TypeError: Cannot set properties of undefined (setting 'ref')"
// The barrel's `toJSONSchema` now `forceMaterialize`s first, so callers get a
// clean conversion without reaching for `forceMaterialize` themselves. This
// reproduces the original failure (the `search_skill` tool schemas) and asserts
// the JSON Schema is both produced AND correct.
describe('toJSONSchema (lazy-aware)', () => {
  it('converts a union nested under .optional() without throwing (the original repro)', () => {
    // Mirrors searchSkillInputSchema.notQuery — the case that surfaced the bug.
    const schema = z.object({
      query: z.string().min(1).max(2048).describe('Natural-language search query'),
      limit: z.number().int().positive().max(50).optional(),
      notQuery: z
        .union([z.string().min(1).max(2048), z.array(z.string().min(1).max(2048)).max(8)])
        .optional()
        .describe('Anti-query'),
    });

    const json = toJSONSchema(schema) as Record<string, any>;

    expect(json['type']).toBe('object');
    expect(Object.keys(json['properties'])).toEqual(['query', 'limit', 'notQuery']);
    // The union must serialize to anyOf with both branches.
    expect(json['properties']['notQuery']['description']).toBe('Anti-query');
    expect(json['properties']['notQuery']['anyOf']).toHaveLength(2);
    // Only `query` is required (the others are .optional()).
    expect(json['required']).toEqual(['query']);
  });

  it('converts a nested array-of-objects with optional fields (search_skill output shape)', () => {
    const schema = z.object({
      skills: z.array(
        z.object({
          skillId: z.string(),
          name: z.string(),
          score: z.number(),
          bundleVersion: z.string().optional(),
        }),
      ),
    });

    const json = toJSONSchema(schema) as Record<string, any>;

    expect(json['type']).toBe('object');
    const item = json['properties']['skills']['items'];
    expect(item['type']).toBe('object');
    expect(item['required']).toEqual(['skillId', 'name', 'score']);
  });

  it('is idempotent — converting the same lazy schema twice yields equal output', () => {
    const schema = z.object({
      mode: z.union([z.literal('a'), z.literal('b')]).optional(),
      tags: z.array(z.string()).max(8).optional(),
    });

    const first = toJSONSchema(schema);
    const second = toJSONSchema(schema);

    expect(second).toEqual(first);
  });

  it('still converts plain (already-real) zod schemas', () => {
    const json = toJSONSchema(z.string().min(2)) as Record<string, any>;
    expect(json['type']).toBe('string');
    expect(json['minLength']).toBe(2);
  });
});
