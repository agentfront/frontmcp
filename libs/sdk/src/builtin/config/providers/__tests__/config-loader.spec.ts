/**
 * Config loader — prototype-safe merging (GHSA-cmrw-xhcg-6gf9 follow-up).
 *
 * `loadConfig` feeds YAML straight into a recursive `deepMerge` that walks every
 * key with `for...in`. A config file is trusted input, so this is hardening
 * rather than a live vector — but a merge over arbitrary keys should not be the
 * one place in the repo that omits the guard `env-loader.ts` already applies.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from '@frontmcp/lazy-zod';
import { mkdtemp, rm, writeFile } from '@frontmcp/utils';

import { deepMerge, loadConfig } from '../config-loader';

/** Keys that reach a prototype rather than the object in hand. */
const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'] as const;

/**
 * Assert the merged object was not re-parented and inherits nothing injected.
 *
 * `result['__proto__'] = {...}` on a plain object re-parents THAT object rather
 * than writing to `Object.prototype`, so a global-pollution probe would pass
 * either way. The observable effect is on the merged config itself: every value
 * in the injected object silently becomes readable on it, which is how a merged
 * config would start answering for keys nobody configured.
 */
function assertNotReparented(merged: Record<string, unknown>): void {
  expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
  expect(merged['polluted']).toBeUndefined();
  // `constructor` must still resolve to the real one, not a config value.
  expect(merged.constructor).toBe(Object);

  // No unsafe key may survive as an OWN property either. `prototype` in
  // particular re-parents nothing and shadows nothing, so the checks above
  // would not notice it — but a config object carrying it is still a merge that
  // copied a key it was told to skip.
  for (const key of UNSAFE_KEYS) {
    expect(Object.prototype.hasOwnProperty.call(merged, key)).toBe(false);
  }

  // And nothing reached the global intrinsics either.
  expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  expect((Object as unknown as Record<string, unknown>)['polluted']).toBeUndefined();
}

afterEach(() => {
  delete (Object.prototype as Record<string, unknown>)['polluted'];
  delete (Object as unknown as Record<string, unknown>)['polluted'];
});

describe('deepMerge — prototype keys', () => {
  it.each(UNSAFE_KEYS)('skips a top-level %s key', (key) => {
    const merged = deepMerge({ keep: 1 }, { [key]: { polluted: true }, other: 2 } as Record<string, unknown>);

    expect(merged['other']).toBe(2);
    expect(merged['keep']).toBe(1);
    assertNotReparented(merged);
  });

  it.each(UNSAFE_KEYS)('skips a NESTED %s key', (key) => {
    const merged = deepMerge({ nested: { keep: 1 } }, {
      nested: { [key]: { polluted: true }, other: 2 },
    } as Record<string, unknown>);

    const nested = merged['nested'] as Record<string, unknown>;
    expect(nested['other']).toBe(2);
    assertNotReparented(nested);
  });

  it('still merges ordinary nested values', () => {
    const merged = deepMerge({ a: { b: 1, c: 2 } }, { a: { c: 3, d: 4 } });

    expect(merged['a']).toEqual({ b: 1, c: 3, d: 4 });
  });

  it('replaces arrays rather than merging them', () => {
    expect(deepMerge({ list: [1, 2, 3] }, { list: [9] })['list']).toEqual([9]);
  });

  it('preserves non-plain values instead of rebuilding them', () => {
    // YAML yields `Date` for a timestamp. Rebuilding it as a plain object would
    // replace the value with `{}` and lose it before the schema sees it.
    const when = new Date('2026-01-01T00:00:00Z');
    const pattern = /^x$/;

    const merged = deepMerge({}, { when, pattern, nested: { when } });

    expect(merged['when']).toBeInstanceOf(Date);
    expect((merged['when'] as Date).toISOString()).toBe(when.toISOString());
    expect(merged['pattern']).toBeInstanceOf(RegExp);
    expect((merged['nested'] as { when: Date }).when).toBeInstanceOf(Date);
  });

  it('still strips unsafe keys from a plain object alongside a Date', () => {
    // Built via JSON.parse, not an object literal: in a literal `__proto__:`
    // sets the prototype, whereas js-yaml (and JSON.parse) create it as an
    // ordinary OWN key — which is the case the guard has to handle.
    const nested = JSON.parse('{"__proto__":{"polluted":true},"keep":1}') as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(nested, '__proto__')).toBe(true);

    const merged = deepMerge({}, { when: new Date('2026-01-01T00:00:00Z'), nested } as Record<string, unknown>);

    expect(merged['when']).toBeInstanceOf(Date);
    assertNotReparented(merged['nested'] as Record<string, unknown>);
    expect((merged['nested'] as Record<string, unknown>)['keep']).toBe(1);
  });
});

describe('loadConfig — YAML with prototype keys', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'frontmcp-config-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads a config whose YAML carries unsafe keys, without mutating prototypes', async () => {
    await writeFile(
      join(dir, 'config.yml'),
      [
        'name: from-yaml',
        '__proto__:',
        '  polluted: true',
        'constructor:',
        '  polluted: true',
        'prototype:',
        '  polluted: true',
        'nested:',
        '  __proto__:',
        '    polluted: true',
        '  value: kept',
      ].join('\n'),
      'utf8',
    );

    // Capture the merged object BEFORE the schema sees it. `z.object` strips
    // unknown keys, so asserting on the parsed result alone would pass even if
    // the raw merge had been re-parented or had copied an unsafe key.
    const raw: Record<string, unknown>[] = [];
    const inner = z.object({
      name: z.string().default('default'),
      nested: z.object({ value: z.string().default('') }).default({ value: '' }),
    });
    const schema = z.preprocess((value) => {
      raw.push(value as Record<string, unknown>);
      return value;
    }, inner) as unknown as typeof inner;

    const config = await loadConfig(schema, { basePath: dir, loadYaml: true, loadEnv: false });

    // The legitimate keys still load…
    expect(config.name).toBe('from-yaml');
    expect(config.nested.value).toBe('kept');

    // …and the object the schema was handed is clean, not merely its output.
    expect(raw).toHaveLength(1);
    assertNotReparented(raw[0]);
    assertNotReparented(raw[0]['nested'] as Record<string, unknown>);
  });
});
