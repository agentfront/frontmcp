/**
 * Emits eager.ts and lazy.ts from the shared descriptor DSL.
 *
 * Produces:
 *  - apps/poc-lazy-zod/src/schemas/eager.ts
 *  - apps/poc-lazy-zod/src/schemas/lazy.ts
 *
 * Both files export the same `schemas` array shape:
 *   export const schemas = [{ name, schema, sample }, ...]
 *
 * The descriptor is converted to a Zod-expression *string* so the emitted
 * TypeScript is literal source (no runtime DSL interpretation in the bundle).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { FieldDescriptor, PrimitiveKind, SchemaDescriptor, VariantDescriptor } from './descriptor';
import { handAuthoredDescriptors } from './hand-authored';

// ---------- deterministic PRNG ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0xc0ffee;
const TOTAL_GENERATED = 1500;
const rng = mulberry32(SEED);
const rand = () => rng();
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

// ---------- field name pools ----------
const NAMES = [
  'id',
  'name',
  'email',
  'age',
  'city',
  'country',
  'region',
  'tag',
  'active',
  'createdAt',
  'updatedAt',
  'score',
  'rank',
  'priority',
  'status',
  'kind',
  'amount',
  'currency',
  'note',
  'title',
  'body',
  'url',
  'mime',
  'size',
  'userId',
  'tenantId',
  'sessionId',
  'traceId',
  'spanId',
  'parentId',
  'count',
  'total',
  'limit',
  'offset',
  'cursor',
  'enabled',
  'visible',
  'category',
  'type',
  'version',
  'locale',
  'timezone',
  'method',
  'host',
  'port',
  'path',
  'query',
  'fragment',
  'scheme',
  'checksum',
  'hash',
];
const ENUM_POOLS: string[][] = [
  ['low', 'medium', 'high', 'critical'],
  ['pending', 'running', 'succeeded', 'failed', 'cancelled'],
  ['read', 'write', 'admin'],
  ['GET', 'POST', 'PUT', 'DELETE'],
  ['metric', 'imperial'],
  ['open', 'closed', 'in_review'],
];
const RECORD_KEY_POOLS: string[][] = [
  ['development', 'staging', 'production'],
  ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1'],
  ['small', 'medium', 'large'],
];

// ---------- descriptor generators ----------
function genField(depth: number): FieldDescriptor {
  const name = pick(NAMES) + '_' + int(0, 9999).toString(36);
  const optional = rand() < 0.25;
  const roll = rand();
  if (depth >= 2 || roll < 0.55) {
    const prim: PrimitiveKind = rand() < 0.5 ? 'string' : rand() < 0.5 ? 'number' : 'boolean';
    return { name, type: prim, optional };
  }
  if (roll < 0.7) {
    return { name, type: 'enum', values: pick(ENUM_POOLS), optional };
  }
  if (roll < 0.82) {
    const items: PrimitiveKind = rand() < 0.5 ? 'string' : 'number';
    return { name, type: 'array', items, optional };
  }
  if (roll < 0.9) {
    return { name, type: 'record', keys: pick(RECORD_KEY_POOLS), optional };
  }
  const childCount = int(2, 5);
  const children: FieldDescriptor[] = [];
  for (let i = 0; i < childCount; i++) children.push(genField(depth + 1));
  return { name, type: 'object', children, optional };
}

function genObjectSchema(index: number): SchemaDescriptor {
  const count = int(5, 15);
  const fields: FieldDescriptor[] = [];
  for (let i = 0; i < count; i++) fields.push(genField(0));
  return { name: `obj_${index}`, kind: 'object', fields, refine: rand() < 0.05 };
}

function genDiscriminatedSchema(index: number): SchemaDescriptor {
  const tagCount = int(3, 5);
  const variants: VariantDescriptor[] = [];
  for (let i = 0; i < tagCount; i++) {
    const fieldCount = int(2, 6);
    const fields: FieldDescriptor[] = [];
    for (let j = 0; j < fieldCount; j++) fields.push(genField(0));
    variants.push({ tag: `variant_${index}_${i}`, fields });
  }
  return { name: `disc_${index}`, kind: 'discriminated', discriminator: 'kind', variants };
}

function genUnionSchema(index: number): SchemaDescriptor {
  const memberCount = int(2, 4);
  const members: SchemaDescriptor[] = [];
  for (let i = 0; i < memberCount; i++) {
    members.push(genObjectSchema(index * 10 + i));
  }
  return { name: `union_${index}`, kind: 'union', members };
}

function genArrayOfObjects(index: number): SchemaDescriptor {
  const count = int(3, 8);
  const item: FieldDescriptor[] = [];
  for (let i = 0; i < count; i++) item.push(genField(0));
  return { name: `arr_${index}`, kind: 'array-of-objects', item };
}

function genAll(total: number): SchemaDescriptor[] {
  const out: SchemaDescriptor[] = [];
  for (let i = 0; i < total; i++) {
    const roll = rand();
    if (roll < 0.55) out.push(genObjectSchema(i));
    else if (roll < 0.75) out.push(genDiscriminatedSchema(i));
    else if (roll < 0.9) out.push(genArrayOfObjects(i));
    else out.push(genUnionSchema(i));
  }
  return out;
}

// ---------- descriptor -> Zod expression string ----------
//
// safeCodeString — wraps JSON.stringify with extra escaping for characters
// that have special meaning inside JS source (closing HTML-script tags,
// forward-slash that could terminate a regex/comment, U+2028/U+2029 line
// separators that some parsers treat as newlines). Any value interpolated
// into the generated TS source MUST go through this helper, not plain
// JSON.stringify — CodeQL flags otherwise-sanitized strings when they're
// used for code construction.
function safeCodeString(value: string): string {
  return JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, (ch) => {
    switch (ch) {
      case '<':
        return '\\u003C';
      case '>':
        return '\\u003E';
      case '/':
        return '\\u002F';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default:
        return ch;
    }
  });
}

function fieldToZodExpr(f: FieldDescriptor): string {
  let expr: string;
  switch (f.type) {
    case 'string':
      expr = 'z.string()';
      break;
    case 'number':
      expr = 'z.number()';
      break;
    case 'boolean':
      expr = 'z.boolean()';
      break;
    case 'enum':
      expr = `z.enum([${f.values.map((v) => safeCodeString(v)).join(', ')}])`;
      break;
    case 'array':
      expr = `z.array(${f.items === 'string' ? 'z.string()' : 'z.number()'})`;
      break;
    case 'record':
      expr = `z.record(z.enum([${f.keys.map((k) => safeCodeString(k)).join(', ')}]), z.string())`;
      break;
    case 'object': {
      const children = f.children.map((c) => `${safeCodeString(c.name)}: ${fieldToZodExpr(c)}`).join(', ');
      expr = `z.object({ ${children} })`;
      break;
    }
  }
  return f.optional ? `${expr}.optional()` : expr;
}

function objectExpr(fields: FieldDescriptor[]): string {
  const entries = fields.map((f) => `${safeCodeString(f.name)}: ${fieldToZodExpr(f)}`).join(', ');
  return `z.object({ ${entries} })`;
}

function descriptorToZodExpr(d: SchemaDescriptor): string {
  switch (d.kind) {
    case 'object': {
      let expr = objectExpr(d.fields);
      if (d.refine) {
        expr = `${expr}.superRefine((_val, _ctx) => { /* noop */ })`;
      }
      return expr;
    }
    case 'discriminated': {
      const variants = d.variants
        .map((v) => {
          const entries = [
            `${safeCodeString(d.discriminator)}: z.literal(${safeCodeString(v.tag)})`,
            ...v.fields.map((f) => `${safeCodeString(f.name)}: ${fieldToZodExpr(f)}`),
          ].join(', ');
          return `z.object({ ${entries} })`;
        })
        .join(', ');
      return `z.discriminatedUnion(${safeCodeString(d.discriminator)}, [${variants}])`;
    }
    case 'union': {
      const members = d.members.map(descriptorToZodExpr).join(', ');
      return `z.union([${members}])`;
    }
    case 'array-of-objects': {
      return `z.array(${objectExpr(d.item)})`;
    }
  }
}

// ---------- sample payload generation ----------
function fieldToSample(f: FieldDescriptor): unknown {
  if (f.optional && rand() < 0.4) return undefined;
  switch (f.type) {
    case 'string':
      return `s_${int(0, 99999).toString(36)}`;
    case 'number':
      return int(0, 1_000_000);
    case 'boolean':
      return rand() < 0.5;
    case 'enum':
      return pick(f.values);
    case 'array': {
      const n = int(0, 4);
      const out: unknown[] = [];
      for (let i = 0; i < n; i++) out.push(f.items === 'string' ? `s_${i}` : int(0, 1000));
      return out;
    }
    case 'record': {
      const out: Record<string, string> = {};
      // Zod v4 requires all enum-keyed record keys to be present
      for (const k of f.keys) out[k] = `v_${int(0, 999).toString(36)}`;
      return out;
    }
    case 'object': {
      return objectSample(f.children);
    }
  }
}

function objectSample(fields: FieldDescriptor[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = fieldToSample(f);
    if (v !== undefined) out[f.name] = v;
  }
  return out;
}

function descriptorToSample(d: SchemaDescriptor): unknown {
  switch (d.kind) {
    case 'object':
      return objectSample(d.fields);
    case 'discriminated': {
      const v = pick(d.variants);
      return { [d.discriminator]: v.tag, ...objectSample(v.fields) };
    }
    case 'union': {
      const m = pick(d.members);
      return descriptorToSample(m);
    }
    case 'array-of-objects': {
      const n = int(1, 3);
      const out: unknown[] = [];
      for (let i = 0; i < n; i++) out.push(objectSample(d.item));
      return out;
    }
  }
}

// ---------- emit ----------
function emit(variant: 'eager' | 'lazy', descriptors: SchemaDescriptor[]): string {
  const header = [
    '/* eslint-disable */',
    '/**',
    ` * AUTO-GENERATED by src/schemas/generate.ts — seed=${SEED.toString(16)}, total=${descriptors.length}.`,
    ' * Do not edit by hand. Re-run `nx run poc-lazy-zod:generate-schemas`.',
    ' */',
    "import { z } from 'zod';",
    variant === 'lazy' ? "import { lazyZ } from '../lazy/lazyZ';" : '',
    '',
    'export const schemas: ReadonlyArray<{ name: string; schema: unknown; sample: unknown }> = [',
  ]
    .filter(Boolean)
    .join('\n');

  const lines: string[] = [];
  for (const d of descriptors) {
    const expr = descriptorToZodExpr(d);
    const sample = JSON.stringify(descriptorToSample(d));
    const schemaExpr = variant === 'lazy' ? `lazyZ(() => ${expr})` : expr;
    lines.push(`  { name: ${safeCodeString(d.name)}, schema: ${schemaExpr}, sample: ${sample} },`);
  }

  return [header, ...lines, '];', ''].join('\n');
}

// ---------- main ----------
function main() {
  const generated = genAll(TOTAL_GENERATED);
  // hand-authored first so "first-parse" hits a realistic shape
  const all: SchemaDescriptor[] = [...(handAuthoredDescriptors as SchemaDescriptor[]), ...generated];

  const outDir = path.join(__dirname);
  fs.writeFileSync(path.join(outDir, 'eager.ts'), emit('eager', all), 'utf8');
  fs.writeFileSync(path.join(outDir, 'lazy.ts'), emit('lazy', all), 'utf8');

  const totalLen = all.length;
  const chars = fs.statSync(path.join(outDir, 'eager.ts')).size;
  const lazyBytes = fs.statSync(path.join(outDir, 'lazy.ts')).size;
  console.log(`[generate] wrote ${totalLen} schemas -> eager.ts (${chars} bytes), lazy.ts (${lazyBytes} bytes)`);
}

main();
