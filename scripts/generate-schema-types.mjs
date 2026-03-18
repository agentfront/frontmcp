/**
 * generate-schema-types.mjs
 *
 * Build-time script that reads Zod schemas and generates TypeScript "Input"
 * interfaces where all fields are optional (for decorator IntelliSense).
 * JSDoc is extracted from .describe() annotations on schema fields.
 *
 * Usage:
 *   npx tsx scripts/generate-schema-types.mjs
 *
 * Generated files are committed to git so IDEs can read them without
 * running the build first.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ============================================
// Schema Targets Configuration
// ============================================

const SCHEMA_TARGETS = [
  {
    importPath: resolve(ROOT, 'libs/guard/src/schemas/schemas.ts'),
    schemas: [
      {
        name: 'concurrencyConfigSchema',
        interfaceName: 'ConcurrencyConfigInput',
        description:
          'Input type for concurrency control configuration.\nAll fields are optional for IDE autocomplete; required fields\nare validated at runtime by concurrencyConfigSchema.',
      },
      {
        name: 'rateLimitConfigSchema',
        interfaceName: 'RateLimitConfigInput',
        description:
          'Input type for rate limiting configuration.\nAll fields are optional for IDE autocomplete; required fields\nare validated at runtime by rateLimitConfigSchema.',
      },
      {
        name: 'timeoutConfigSchema',
        interfaceName: 'TimeoutConfigInput',
        description:
          'Input type for timeout configuration.\nAll fields are optional for IDE autocomplete; required fields\nare validated at runtime by timeoutConfigSchema.',
      },
      {
        name: 'ipFilterConfigSchema',
        interfaceName: 'IpFilterConfigInput',
        description:
          'Input type for IP filtering configuration.\nAll fields are optional for IDE autocomplete; required fields\nare validated at runtime by ipFilterConfigSchema.',
      },
      {
        name: 'guardConfigSchema',
        interfaceName: 'GuardConfigInput',
        description:
          'Input type for guard system configuration.\nAll fields are optional for IDE autocomplete; required fields\nare validated at runtime by guardConfigSchema.',
        // Override nested schema types to use generated Input types
        typeOverrides: {
          global: 'RateLimitConfigInput',
          globalConcurrency: 'ConcurrencyConfigInput',
          defaultRateLimit: 'RateLimitConfigInput',
          defaultConcurrency: 'ConcurrencyConfigInput',
          defaultTimeout: 'TimeoutConfigInput',
          ipFilter: 'IpFilterConfigInput',
          storage: 'Record<string, unknown>',
        },
      },
    ],
    outputFile: resolve(ROOT, 'libs/guard/src/schemas/schemas.generated.ts'),
    imports: ["import type { PartitionKey } from '../partition-key/types';"],
  },
];

// ============================================
// Zod Schema Walker (uses constructor.name, compatible with Zod v3 and v4)
// ============================================

/**
 * Get the Zod type name from a schema instance.
 * Works with both Zod v3 (_def.typeName) and Zod v4 (constructor.name / _def.type).
 */
function getZodTypeName(schema) {
  if (!schema) return 'unknown';
  // Zod v3 uses _def.typeName
  if (schema._def?.typeName) return schema._def.typeName;
  // Zod v4 uses constructor.name
  return schema.constructor?.name || 'unknown';
}

/**
 * Unwrap layers of ZodOptional, ZodDefault, ZodEffects, ZodNullable
 * and collect metadata along the way.
 */
/** Stringify a JS value using single quotes for strings (prettier-compatible). */
function toTsLiteral(value) {
  if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`;
  return JSON.stringify(value);
}

function unwrapSchema(schema) {
  let optional = false;
  let defaultValue;
  // .describe() text lives on schema.description in both v3 and v4
  let description = schema?.description;

  let current = schema;
  let maxDepth = 20;

  while (current && maxDepth-- > 0) {
    const typeName = getZodTypeName(current);

    if (!description) {
      description = current.description;
    }

    if (typeName === 'ZodOptional') {
      optional = true;
      current = current._def.innerType;
      continue;
    }

    if (typeName === 'ZodDefault') {
      optional = true;
      const dv = current._def.defaultValue;
      if (typeof dv === 'function') {
        try {
          defaultValue = JSON.stringify(dv());
        } catch {
          /* ignore */
        }
      } else if (dv !== undefined) {
        defaultValue = JSON.stringify(dv);
      }
      current = current._def.innerType;
      continue;
    }

    if (typeName === 'ZodEffects') {
      current = current._def.schema;
      continue;
    }

    if (typeName === 'ZodNullable') {
      current = current._def.innerType;
      continue;
    }

    if (typeName === 'ZodPipeline') {
      current = current._def.in;
      continue;
    }

    break;
  }

  return { inner: current, optional, defaultValue, description };
}

/**
 * Check if a schema matches the PartitionKey union pattern:
 * z.union([ z.enum(['ip','session','userId','global']), z.custom<fn>() ])
 */
function isPartitionKeySchema(schema) {
  const typeName = getZodTypeName(schema);
  if (typeName !== 'ZodUnion') return false;
  const options = schema._def.options || [];
  if (options.length !== 2) return false;
  const first = options[0];
  if (getZodTypeName(first) !== 'ZodEnum') return false;
  // Zod v4 uses _def.entries (object), v3 uses _def.values (array)
  const entries = first._def.entries || {};
  const values = Array.isArray(first._def.values) ? first._def.values : Object.keys(entries);
  return values.includes('ip') && values.includes('session') && values.includes('global');
}

/**
 * Convert a Zod schema to a TypeScript type string.
 */
function zodToTsType(schema, depth = 0) {
  if (!schema) return 'unknown';

  const typeName = getZodTypeName(schema);

  // Check for known special schemas first
  if (isPartitionKeySchema(schema)) return 'PartitionKey';

  switch (typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodBigInt':
      return 'bigint';
    case 'ZodDate':
      return 'Date';
    case 'ZodNull':
      return 'null';
    case 'ZodUndefined':
      return 'undefined';
    case 'ZodVoid':
      return 'void';
    case 'ZodAny':
    case 'ZodUnknown':
      return 'unknown';

    case 'ZodLiteral':
      return toTsLiteral(schema._def.value);

    case 'ZodEnum': {
      // Zod v4 uses _def.entries (object), v3 uses _def.values (array)
      const entries = schema._def.entries || {};
      const vals = Array.isArray(schema._def.values) ? schema._def.values : Object.values(entries);
      return vals.map((v) => toTsLiteral(v)).join(' | ');
    }

    case 'ZodNativeEnum': {
      const enumObj = schema._def.values || {};
      const vals = Object.values(enumObj).filter((v) => typeof v === 'string' || typeof v === 'number');
      return vals.map((v) => toTsLiteral(v)).join(' | ') || 'unknown';
    }

    case 'ZodArray':
      return `Array<${zodToTsType(schema._def.element || schema._def.type, depth)}>`;

    case 'ZodRecord': {
      const keyType = zodToTsType(schema._def.keyType, depth);
      const valueType = zodToTsType(schema._def.valueType, depth);
      return `Record<${keyType}, ${valueType}>`;
    }

    case 'ZodObject': {
      const shape = typeof schema._def.shape === 'function' ? schema._def.shape() : schema._def.shape || {};
      const indent = '  '.repeat(depth + 1);
      const closingIndent = '  '.repeat(depth);
      const entries = Object.entries(shape);
      if (entries.length === 0) return 'Record<string, unknown>';
      const fields = entries.map(([key, fieldSchema]) => {
        const { inner, description: desc } = unwrapSchema(fieldSchema);
        const tsType = zodToTsType(inner, depth + 1);
        const jsdoc = desc ? `${indent}/** ${desc} */\n` : '';
        return `${jsdoc}${indent}${key}?: ${tsType};`;
      });
      return `{\n${fields.join('\n')}\n${closingIndent}}`;
    }

    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = schema._def.options || [];
      return options.map((o) => zodToTsType(o, depth)).join(' | ') || 'unknown';
    }

    case 'ZodIntersection': {
      const left = zodToTsType(schema._def.left, depth);
      const right = zodToTsType(schema._def.right, depth);
      return `${left} & ${right}`;
    }

    case 'ZodTuple': {
      const items = schema._def.items || [];
      return `[${items.map((i) => zodToTsType(i, depth)).join(', ')}]`;
    }

    case 'ZodOptional':
      return zodToTsType(schema._def.innerType, depth);

    case 'ZodNullable':
      return `${zodToTsType(schema._def.innerType, depth)} | null`;

    case 'ZodDefault':
      return zodToTsType(schema._def.innerType, depth);

    case 'ZodEffects':
      return zodToTsType(schema._def.schema, depth);

    case 'ZodLazy':
      return 'unknown';

    case 'ZodFunction':
      return 'Function';

    case 'ZodPipeline':
      return zodToTsType(schema._def.in, depth);

    case 'ZodCustom':
      return 'unknown';

    default:
      return 'unknown';
  }
}

/**
 * Extract fields from a ZodObject schema.
 * @param {any} schema - ZodObject schema
 * @param {Record<string, string>} [typeOverrides] - field name → TS type string overrides
 */
function extractFields(schema, typeOverrides = {}) {
  const unwrapped = unwrapSchema(schema);
  const obj = unwrapped.inner;
  const typeName = getZodTypeName(obj);

  if (typeName !== 'ZodObject') {
    throw new Error(`Expected ZodObject, got ${typeName}`);
  }

  const shape = typeof obj._def.shape === 'function' ? obj._def.shape() : obj._def.shape || {};
  const fields = [];

  for (const [name, fieldSchema] of Object.entries(shape)) {
    const { inner, defaultValue, description } = unwrapSchema(fieldSchema);

    // Use type override if provided, otherwise resolve from Zod schema
    const tsType = typeOverrides[name] || zodToTsType(inner);

    fields.push({
      name,
      tsType,
      optional: true, // All fields optional for Input types
      description,
      defaultValue,
    });
  }

  return fields;
}

// ============================================
// Interface Generator
// ============================================

function generateInterface(name, fields, description) {
  const lines = [];

  if (description) {
    lines.push('/**');
    for (const line of description.split('\n')) {
      lines.push(` * ${line}`);
    }
    lines.push(' */');
  }

  lines.push(`export interface ${name} {`);

  for (const field of fields) {
    const jsdocParts = [];
    if (field.description) jsdocParts.push(field.description);
    if (field.defaultValue !== undefined) jsdocParts.push(`@default ${field.defaultValue}`);

    if (jsdocParts.length > 0) {
      if (jsdocParts.length === 1 && !jsdocParts[0].includes('\n')) {
        lines.push(`  /** ${jsdocParts[0]} */`);
      } else {
        lines.push('  /**');
        for (const part of jsdocParts) {
          for (const l of part.split('\n')) lines.push(`   * ${l}`);
        }
        lines.push('   */');
      }
    }

    const optMark = field.optional ? '?' : '';
    lines.push(`  ${field.name}${optMark}: ${field.tsType};`);
  }

  lines.push('}');
  return lines.join('\n');
}

// ============================================
// Main
// ============================================

const HEADER = `// AUTO-GENERATED from Zod schemas — do not edit manually.
// Run: npx tsx scripts/generate-schema-types.mjs
// Source: scripts/generate-schema-types.mjs`;

async function main() {
  let changed = false;

  for (const target of SCHEMA_TARGETS) {
    const mod = await import(target.importPath);
    const sections = [HEADER, ''];

    if (target.imports?.length) {
      sections.push(...target.imports, '');
    }

    for (const entry of target.schemas) {
      const schema = mod[entry.name];
      if (!schema) {
        console.error(`Schema "${entry.name}" not found in ${target.importPath}`);
        process.exit(1);
      }

      const fields = extractFields(schema, entry.typeOverrides);
      const iface = generateInterface(entry.interfaceName, fields, entry.description);
      sections.push(iface, '');
    }

    const content = sections.join('\n');
    const outPath = target.outputFile;

    if (existsSync(outPath)) {
      const existing = readFileSync(outPath, 'utf-8');
      if (existing === content) {
        console.log(`  ✓ ${relative(ROOT, outPath)} (up to date)`);
        continue;
      }
    }

    writeFileSync(outPath, content, 'utf-8');
    console.log(`  ✏ ${relative(ROOT, outPath)} (generated)`);
    changed = true;
  }

  if (!changed) {
    console.log('All generated types are up to date.');
  }
}

main().catch((err) => {
  console.error('generate-schema-types failed:', err);
  process.exit(1);
});
