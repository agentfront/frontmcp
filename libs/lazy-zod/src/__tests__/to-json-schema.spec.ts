import { eagerZ, toJSONSchema, z } from '../index';

type JsonObject = Record<string, unknown>;

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

    const json = toJSONSchema(schema) as JsonObject;
    const properties = json['properties'] as Record<string, JsonObject>;
    const notQuery = properties['notQuery'];

    expect(json['type']).toBe('object');
    expect(Object.keys(properties)).toEqual(['query', 'limit', 'notQuery']);
    // The union must serialize to anyOf with both branches.
    expect(notQuery['description']).toBe('Anti-query');
    expect(notQuery['anyOf']).toHaveLength(2);
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

    const json = toJSONSchema(schema) as JsonObject;
    const properties = json['properties'] as Record<string, JsonObject>;
    const skills = properties['skills'];
    const item = skills['items'] as JsonObject;

    expect(json['type']).toBe('object');
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
    const json = toJSONSchema(eagerZ.string().min(2)) as JsonObject;
    expect(json['type']).toBe('string');
    expect(json['minLength']).toBe(2);
  });
});
