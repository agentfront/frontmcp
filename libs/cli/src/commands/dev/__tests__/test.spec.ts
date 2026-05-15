// libs/cli/src/commands/dev/__tests__/test.spec.ts
//
// Unit tests for `generateJestConfig` (issue #402).
//
// Issue #402 had two layers:
//   1. The injected `transform` regex `^.+\\.[tj]s$` skipped `.tsx`. Even when
//      it matched, the SWC parser was `typescript` without `tsx: true`, so JSX
//      syntax failed to parse.
//   2. The `testMatch` only included `e2e/**/*.e2e.ts(x)?` patterns, missing
//      colocated `*.spec.ts(x)` files (the CLAUDE.md convention).
//
// These tests lock in the post-fix shape so a future refactor can't silently
// drop `.tsx` support or the unit-test patterns.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { type ParsedArgs } from '../../../core/args';
import { buildJestArgs, findUserJestConfig, generateJestConfig } from '../test';

type JestConfig = {
  testEnvironment: string;
  rootDir: string;
  testMatch: string[];
  transform: Record<string, [string, Record<string, unknown>]>;
  moduleFileExtensions: string[];
  testTimeout: number;
  collectCoverage: boolean;
  collectCoverageFrom?: string[];
  verbose: boolean;
};

const makeOpts = (overrides: Partial<ParsedArgs> = {}): ParsedArgs => ({
  _: ['test'],
  ...overrides,
});

describe('generateJestConfig (issue #402)', () => {
  describe('testMatch', () => {
    it('includes colocated *.spec.ts and *.spec.tsx under src/', () => {
      const cfg = generateJestConfig('/proj', makeOpts()) as JestConfig;
      expect(cfg.testMatch).toEqual(expect.arrayContaining(['<rootDir>/src/**/*.spec.ts']));
      expect(cfg.testMatch).toEqual(expect.arrayContaining(['<rootDir>/src/**/*.spec.tsx']));
    });

    it('includes __tests__/ specs (.ts and .tsx)', () => {
      const cfg = generateJestConfig('/proj', makeOpts()) as JestConfig;
      expect(cfg.testMatch).toEqual(expect.arrayContaining(['<rootDir>/**/__tests__/**/*.spec.ts']));
      expect(cfg.testMatch).toEqual(expect.arrayContaining(['<rootDir>/**/__tests__/**/*.spec.tsx']));
    });

    it('includes the e2e .e2e.spec.ts(x) patterns (per CLAUDE.md convention)', () => {
      const cfg = generateJestConfig('/proj', makeOpts()) as JestConfig;
      expect(cfg.testMatch).toEqual(expect.arrayContaining(['<rootDir>/e2e/**/*.e2e.spec.ts']));
      expect(cfg.testMatch).toEqual(expect.arrayContaining(['<rootDir>/e2e/**/*.e2e.spec.tsx']));
    });

    it('does NOT include non-spec `.e2e.ts(x)` patterns (CodeRabbit PR #425)', () => {
      const cfg = generateJestConfig('/proj', makeOpts()) as JestConfig;
      // The repo convention is strictly `.e2e.spec.ts(x)` — matching `.e2e.ts`
      // would let stragglers that violate the convention slip through.
      expect(cfg.testMatch).not.toEqual(expect.arrayContaining(['<rootDir>/e2e/**/*.e2e.ts']));
      expect(cfg.testMatch).not.toEqual(expect.arrayContaining(['<rootDir>/e2e/**/*.e2e.tsx']));
      expect(cfg.testMatch).not.toEqual(expect.arrayContaining(['<rootDir>/**/*.e2e.ts']));
      expect(cfg.testMatch).not.toEqual(expect.arrayContaining(['<rootDir>/**/*.e2e.tsx']));
    });
  });

  describe('transform', () => {
    it('uses a transform regex that matches both .ts/.js and .tsx/.jsx', () => {
      const cfg = generateJestConfig('/proj', makeOpts()) as JestConfig;
      const keys = Object.keys(cfg.transform);
      expect(keys).toHaveLength(1);
      const re = new RegExp(keys[0]);
      expect(re.test('/abs/path/foo.ts')).toBe(true);
      expect(re.test('/abs/path/foo.tsx')).toBe(true);
      expect(re.test('/abs/path/foo.js')).toBe(true);
      expect(re.test('/abs/path/foo.jsx')).toBe(true);
      expect(re.test('/abs/path/foo.md')).toBe(false);
    });

    it('configures SWC parser with tsx: true (JSX syntax usable in tests)', () => {
      const cfg = generateJestConfig('/proj', makeOpts()) as JestConfig;
      const swc = Object.values(cfg.transform)[0]?.[1] as {
        jsc?: { parser?: { syntax?: string; tsx?: boolean; decorators?: boolean } };
      };
      expect(swc?.jsc?.parser?.syntax).toBe('typescript');
      expect(swc?.jsc?.parser?.tsx).toBe(true);
      // Decorators must still work for `@Tool` etc.
      expect(swc?.jsc?.parser?.decorators).toBe(true);
    });

    it('enables the automatic JSX runtime (so React imports are implicit)', () => {
      const cfg = generateJestConfig('/proj', makeOpts()) as JestConfig;
      const swc = Object.values(cfg.transform)[0]?.[1] as {
        jsc?: { transform?: { react?: { runtime?: string }; legacyDecorator?: boolean; decoratorMetadata?: boolean } };
      };
      expect(swc?.jsc?.transform?.react?.runtime).toBe('automatic');
      // Existing decorator settings must remain intact.
      expect(swc?.jsc?.transform?.legacyDecorator).toBe(true);
      expect(swc?.jsc?.transform?.decoratorMetadata).toBe(true);
    });
  });

  describe('moduleFileExtensions', () => {
    it('includes both ts and tsx', () => {
      const cfg = generateJestConfig('/proj', makeOpts()) as JestConfig;
      expect(cfg.moduleFileExtensions).toEqual(expect.arrayContaining(['ts', 'tsx']));
    });
  });

  describe('coverage', () => {
    it('includes both .ts and .tsx in collectCoverageFrom when coverage is on', () => {
      const cfg = generateJestConfig('/proj', makeOpts({ coverage: true })) as JestConfig;
      expect(cfg.collectCoverageFrom).toEqual(expect.arrayContaining(['<rootDir>/src/**/*.ts']));
      expect(cfg.collectCoverageFrom).toEqual(expect.arrayContaining(['<rootDir>/src/**/*.tsx']));
      // ...and excludes specs from both extensions.
      expect(cfg.collectCoverageFrom).toEqual(expect.arrayContaining(['!<rootDir>/src/**/*.spec.ts']));
      expect(cfg.collectCoverageFrom).toEqual(expect.arrayContaining(['!<rootDir>/src/**/*.spec.tsx']));
    });

    it('omits coverage config when coverage flag is unset', () => {
      const cfg = generateJestConfig('/proj', makeOpts()) as JestConfig;
      expect(cfg.collectCoverage).toBe(false);
      expect(cfg.collectCoverageFrom).toBeUndefined();
    });
  });

  describe('rootDir + timeout', () => {
    it('passes cwd through as rootDir', () => {
      const cfg = generateJestConfig('/abs/path/to/proj', makeOpts()) as JestConfig;
      expect(cfg.rootDir).toBe('/abs/path/to/proj');
    });

    it('honors the --timeout option', () => {
      const cfg = generateJestConfig('/proj', makeOpts({ timeout: 30_000 })) as JestConfig;
      expect(cfg.testTimeout).toBe(30_000);
    });

    it('defaults timeout to 60_000', () => {
      const cfg = generateJestConfig('/proj', makeOpts()) as JestConfig;
      expect(cfg.testTimeout).toBe(60_000);
    });
  });
});

describe('findUserJestConfig (issue #402)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'fix-402-find-cfg-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns undefined when no config file exists', async () => {
    expect(await findUserJestConfig(tmpDir)).toBeUndefined();
  });

  it('picks up jest.config.ts when present', async () => {
    const p = path.join(tmpDir, 'jest.config.ts');
    await writeFile(p, 'export default {};');
    expect(await findUserJestConfig(tmpDir)).toBe(p);
  });

  it('picks up jest.config.js when present', async () => {
    const p = path.join(tmpDir, 'jest.config.js');
    await writeFile(p, 'module.exports = {};');
    expect(await findUserJestConfig(tmpDir)).toBe(p);
  });

  it('picks up jest.config.json when present', async () => {
    const p = path.join(tmpDir, 'jest.config.json');
    await writeFile(p, '{}');
    expect(await findUserJestConfig(tmpDir)).toBe(p);
  });

  it("prefers .ts over .js when both are present (matches Jest's own resolution)", async () => {
    const ts = path.join(tmpDir, 'jest.config.ts');
    const js = path.join(tmpDir, 'jest.config.js');
    await writeFile(ts, 'export default {};');
    await writeFile(js, 'module.exports = {};');
    expect(await findUserJestConfig(tmpDir)).toBe(ts);
  });

  it("prefers .js over .mjs/.cjs/.json (matches Jest's own resolution)", async () => {
    const js = path.join(tmpDir, 'jest.config.js');
    const mjs = path.join(tmpDir, 'jest.config.mjs');
    const cjs = path.join(tmpDir, 'jest.config.cjs');
    const json = path.join(tmpDir, 'jest.config.json');
    await writeFile(js, 'module.exports = {};');
    await writeFile(mjs, 'export default {};');
    await writeFile(cjs, 'module.exports = {};');
    await writeFile(json, '{}');
    expect(await findUserJestConfig(tmpDir)).toBe(js);
  });
});

describe('buildJestArgs (issue #402)', () => {
  const base = ['jest', '--config', '/tmp/cfg.json'];

  it('returns just [jest, --config, <path>] for default opts', () => {
    expect(buildJestArgs('/tmp/cfg.json', { _: ['test'] })).toEqual(base);
  });

  it('appends --runInBand when opts.runInBand', () => {
    const args = buildJestArgs('/tmp/cfg.json', { _: ['test'], runInBand: true });
    expect(args).toEqual([...base, '--runInBand']);
  });

  it('appends --watch when opts.watch', () => {
    const args = buildJestArgs('/tmp/cfg.json', { _: ['test'], watch: true });
    expect(args).toEqual([...base, '--watch']);
  });

  it('appends --verbose when opts.verbose', () => {
    const args = buildJestArgs('/tmp/cfg.json', { _: ['test'], verbose: true });
    expect(args).toEqual([...base, '--verbose']);
  });

  it('appends --coverage when opts.coverage', () => {
    const args = buildJestArgs('/tmp/cfg.json', { _: ['test'], coverage: true });
    expect(args).toEqual([...base, '--coverage']);
  });

  it('appends positional patterns after the flags', () => {
    const args = buildJestArgs('/tmp/cfg.json', { _: ['test'], runInBand: true }, ['some-pattern', 'another']);
    expect(args).toEqual([...base, '--runInBand', 'some-pattern', 'another']);
  });

  it('combines all flags + patterns in order', () => {
    const args = buildJestArgs(
      '/tmp/cfg.json',
      { _: ['test'], runInBand: true, watch: true, verbose: true, coverage: true },
      ['my-spec'],
    );
    expect(args).toEqual([...base, '--runInBand', '--watch', '--verbose', '--coverage', 'my-spec']);
  });
});
