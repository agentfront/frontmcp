/**
 * Unit tests for the cascading output-schema-exposure policy.
 *
 * Covers the pure helpers in `../output-policy`:
 *   - `resolveOutputSchemaMode` — Tool > App > server > 'definition' cascade.
 *   - `resolveSchemaDescriptionFormat` — Tool > App > server > 'summary' cascade.
 *   - `formatOutputSchemaForDescription` — 'summary' (property bullets w/ required
 *     vs optional, descriptions, array / enum / union types, no-properties fallback)
 *     and 'jsonSchema' (fenced JSON block) renderings.
 */
import {
  DEFAULT_OUTPUT_SCHEMA_MODE,
  DEFAULT_SCHEMA_DESCRIPTION_FORMAT,
  formatOutputSchemaForDescription,
  outputPolicySchema,
  resolveOutputSchemaMode,
  resolveSchemaDescriptionFormat,
  type OutputPolicy,
} from '../output-policy';

describe('output-policy', () => {
  describe('resolveOutputSchemaMode', () => {
    it("defaults to 'definition' when every level is undefined", () => {
      expect(DEFAULT_OUTPUT_SCHEMA_MODE).toBe('definition');
      expect(resolveOutputSchemaMode(undefined, undefined, undefined)).toBe('definition');
      expect(resolveOutputSchemaMode()).toBe('definition');
    });

    it("falls back to 'definition' when all levels omit schemaMode (present but empty)", () => {
      expect(resolveOutputSchemaMode({}, {}, {})).toBe('definition');
    });

    it('uses the server value when only the server sets schemaMode', () => {
      expect(resolveOutputSchemaMode(undefined, undefined, { schemaMode: 'none' })).toBe('none');
    });

    it('app overrides server', () => {
      expect(resolveOutputSchemaMode(undefined, { schemaMode: 'description' }, { schemaMode: 'none' })).toBe(
        'description',
      );
    });

    it('tool overrides app and server (tool wins)', () => {
      expect(
        resolveOutputSchemaMode({ schemaMode: 'both' }, { schemaMode: 'description' }, { schemaMode: 'none' }),
      ).toBe('both');
    });

    it('skips a level whose schemaMode is undefined and uses the next one down', () => {
      // tool present but no schemaMode → app value
      expect(resolveOutputSchemaMode({}, { schemaMode: 'description' }, { schemaMode: 'none' })).toBe('description');
      // tool + app present but no schemaMode → server value
      expect(resolveOutputSchemaMode({}, {}, { schemaMode: 'none' })).toBe('none');
    });
  });

  describe('resolveSchemaDescriptionFormat', () => {
    it("defaults to 'summary' when every level is undefined", () => {
      expect(DEFAULT_SCHEMA_DESCRIPTION_FORMAT).toBe('summary');
      expect(resolveSchemaDescriptionFormat(undefined, undefined, undefined)).toBe('summary');
      expect(resolveSchemaDescriptionFormat()).toBe('summary');
    });

    it("falls back to 'summary' when all levels omit schemaDescriptionFormat", () => {
      expect(resolveSchemaDescriptionFormat({}, {}, {})).toBe('summary');
    });

    it('uses the server value when only the server sets the format', () => {
      expect(resolveSchemaDescriptionFormat(undefined, undefined, { schemaDescriptionFormat: 'jsonSchema' })).toBe(
        'jsonSchema',
      );
    });

    it('app overrides server', () => {
      expect(
        resolveSchemaDescriptionFormat(
          undefined,
          { schemaDescriptionFormat: 'summary' },
          { schemaDescriptionFormat: 'jsonSchema' },
        ),
      ).toBe('summary');
    });

    it('tool overrides app and server (tool wins)', () => {
      expect(
        resolveSchemaDescriptionFormat(
          { schemaDescriptionFormat: 'jsonSchema' },
          { schemaDescriptionFormat: 'summary' },
          { schemaDescriptionFormat: 'summary' },
        ),
      ).toBe('jsonSchema');
    });

    it('skips a level whose format is undefined and uses the next one down', () => {
      expect(
        resolveSchemaDescriptionFormat(
          {},
          { schemaDescriptionFormat: 'jsonSchema' },
          { schemaDescriptionFormat: 'summary' },
        ),
      ).toBe('jsonSchema');
      expect(resolveSchemaDescriptionFormat({}, {}, { schemaDescriptionFormat: 'jsonSchema' })).toBe('jsonSchema');
    });
  });

  describe('formatOutputSchemaForDescription — summary', () => {
    it('renders a property list with required vs optional markers and descriptions', () => {
      const schema = {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique id' },
          score: { type: 'number' },
        },
        required: ['id'],
      };

      const out = formatOutputSchemaForDescription(schema, 'summary');

      expect(out).toContain('**Returns:**');
      // required property, with its description appended
      expect(out).toContain('- `id`: string (required) — Unique id');
      // optional property, no description suffix
      expect(out).toContain('- `score`: number (optional)');
      // each property is rendered on its own bullet line
      expect(out.split('\n').filter((l) => l.startsWith('- `')).length).toBe(2);
      // a leading blank-line separator precedes the heading
      expect(out.startsWith('\n\n**Returns:**')).toBe(true);
    });

    it('renders array item types as `T[]`', () => {
      const schema = {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: [],
      };

      const out = formatOutputSchemaForDescription(schema, 'summary');
      expect(out).toContain('- `tags`: string[] (optional)');
    });

    it('renders an array of unspecified items as `any[]`', () => {
      const schema = {
        type: 'object',
        properties: {
          items: { type: 'array' },
        },
      };

      const out = formatOutputSchemaForDescription(schema, 'summary');
      expect(out).toContain('- `items`: any[] (optional)');
    });

    it('renders enum values as a quoted union', () => {
      const schema = {
        type: 'object',
        properties: {
          status: { enum: ['open', 'closed'] },
        },
        required: ['status'],
      };

      const out = formatOutputSchemaForDescription(schema, 'summary');
      expect(out).toContain('- `status`: "open" | "closed" (required)');
    });

    it('renders a union `type` array joined with ` | `', () => {
      const schema = {
        type: 'object',
        properties: {
          value: { type: ['string', 'number'] },
        },
      };

      const out = formatOutputSchemaForDescription(schema, 'summary');
      expect(out).toContain('- `value`: string | number (optional)');
    });

    it('falls back to **Returns:** `<type>` when there are no properties', () => {
      const out = formatOutputSchemaForDescription({ type: 'string' }, 'summary');
      expect(out).toBe('\n\n**Returns:** `string`');
    });

    it('uses the no-properties fallback when properties is an empty object', () => {
      const out = formatOutputSchemaForDescription({ type: 'object', properties: {} }, 'summary');
      expect(out).toBe('\n\n**Returns:** `object`');
    });

    it('renders a bare object (no type) in the fallback as `object`', () => {
      const out = formatOutputSchemaForDescription({}, 'summary');
      expect(out).toBe('\n\n**Returns:** `object`');
    });

    it('renders a top-level array type in the fallback', () => {
      const out = formatOutputSchemaForDescription({ type: 'array', items: { type: 'number' } }, 'summary');
      expect(out).toBe('\n\n**Returns:** `number[]`');
    });
  });

  describe('formatOutputSchemaForDescription — jsonSchema', () => {
    it('renders a fenced json code block of the full schema', () => {
      const schema = {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      };

      const out = formatOutputSchemaForDescription(schema, 'jsonSchema');

      expect(out).toContain('**Output schema:**');
      expect(out).toContain('```json');
      expect(out.trimEnd().endsWith('```')).toBe(true);
      // the fenced block is the pretty-printed JSON of the exact schema
      expect(out).toContain(JSON.stringify(schema, null, 2));
    });

    it('uses the jsonSchema rendering even when the schema has no properties', () => {
      const schema = { type: 'string' };
      const out = formatOutputSchemaForDescription(schema, 'jsonSchema');
      expect(out).toContain('```json');
      expect(out).toContain(JSON.stringify(schema, null, 2));
      // it must NOT use the summary fallback
      expect(out).not.toContain('**Returns:**');
    });
  });

  describe('outputPolicySchema', () => {
    it('accepts a fully-specified policy', () => {
      const parsed = outputPolicySchema.parse({
        allowNonFinite: true,
        schemaMode: 'both',
        schemaDescriptionFormat: 'jsonSchema',
      } satisfies OutputPolicy);
      expect(parsed).toEqual({
        allowNonFinite: true,
        schemaMode: 'both',
        schemaDescriptionFormat: 'jsonSchema',
      });
    });

    it('accepts an empty policy (all fields optional)', () => {
      expect(outputPolicySchema.parse({})).toEqual({});
    });

    it('rejects an unknown schemaMode', () => {
      expect(() => outputPolicySchema.parse({ schemaMode: 'verbose' })).toThrow();
    });

    it('rejects an unknown schemaDescriptionFormat', () => {
      expect(() => outputPolicySchema.parse({ schemaDescriptionFormat: 'markdown' })).toThrow();
    });
  });
});
