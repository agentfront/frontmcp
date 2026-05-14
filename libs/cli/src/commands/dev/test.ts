import { spawn, type ChildProcess } from 'child_process';
import * as os from 'os';
import * as path from 'path';

import { fileExists, unlink, writeFile } from '@frontmcp/utils';

import { type ParsedArgs } from '../../core/args';
import { c } from '../../core/colors';

/**
 * Filenames in cwd that, when present, cause `frontmcp test` to delegate to
 * the user's own Jest config instead of injecting one. Order matters — Jest's
 * own resolution is `ts > js > mjs > cjs > json`.
 */
const USER_JEST_CONFIG_FILES = [
  'jest.config.ts',
  'jest.config.js',
  'jest.config.mjs',
  'jest.config.cjs',
  'jest.config.json',
];

export async function findUserJestConfig(cwd: string): Promise<string | undefined> {
  for (const name of USER_JEST_CONFIG_FILES) {
    const p = path.join(cwd, name);

    if (await fileExists(p)) return p;
  }
  return undefined;
}

/**
 * Build the args passed to `npx jest`. Extracted from `runTest` so the args
 * matrix can be unit-tested without spawning a subprocess.
 *
 * @internal
 */
export function buildJestArgs(configPath: string, opts: ParsedArgs, positionalPatterns: string[] = []): string[] {
  const args: string[] = ['jest', '--config', configPath];
  if (opts.runInBand) args.push('--runInBand');
  if (opts.watch) args.push('--watch');
  if (opts.verbose) args.push('--verbose');
  if (opts.coverage) args.push('--coverage');
  if (positionalPatterns.length > 0) args.push(...positionalPatterns);
  return args;
}

/**
 * Generate Jest configuration programmatically.
 *
 * Issue #402: the original config (a) only ran `e2e/**` and `**\/*.e2e.ts`,
 * missing the `*.spec.ts(x)` colocated unit tests mandated by CLAUDE.md, and
 * (b) only transformed `.ts`/`.js` with a `typescript` parser, so any `.tsx`
 * file failed both the regex AND SWC's parser. This generator now:
 *   - matches both colocated unit specs and e2e specs (`.ts` + `.tsx`),
 *   - transforms `.tsx`/`.jsx` files with `tsx: true` and the automatic JSX
 *     runtime so React components are usable in tests,
 *   - exposes the helper for unit testing.
 */
export function generateJestConfig(cwd: string, opts: ParsedArgs): object {
  const testTimeout = opts.timeout ?? 60000;

  return {
    // Use Node.js environment for E2E tests
    testEnvironment: 'node',

    // Root directory for tests
    rootDir: cwd,

    // Match both colocated unit specs (`src/**/*.spec.ts(x)`,
    // `**/__tests__/**/*.spec.ts(x)`) AND e2e specs. The repo convention per
    // CLAUDE.md is `.spec.ts` (NOT `.test.ts`) for unit tests; `.e2e.spec.ts`
    // for e2e; `.pw.spec.ts` for Playwright; `.perf.spec.ts` for perf.
    testMatch: [
      '<rootDir>/src/**/*.spec.ts',
      '<rootDir>/src/**/*.spec.tsx',
      '<rootDir>/**/__tests__/**/*.spec.ts',
      '<rootDir>/**/__tests__/**/*.spec.tsx',
      '<rootDir>/e2e/**/*.e2e.ts',
      '<rootDir>/e2e/**/*.e2e.tsx',
      '<rootDir>/e2e/**/*.e2e.spec.ts',
      '<rootDir>/e2e/**/*.e2e.spec.tsx',
      '<rootDir>/**/*.e2e.ts',
      '<rootDir>/**/*.e2e.tsx',
    ],

    // Transform TypeScript files using @swc/jest for speed. Accepts both
    // `.ts/.js` and `.tsx/.jsx`; the SWC parser is set up with `tsx: true`
    // and the automatic JSX runtime so React components work without
    // additional setup.
    transform: {
      '^.+\\.[tj]sx?$': [
        '@swc/jest',
        {
          jsc: {
            target: 'es2022',
            parser: {
              syntax: 'typescript',
              tsx: true,
              decorators: true,
              dynamicImport: true,
            },
            transform: {
              decoratorMetadata: true,
              legacyDecorator: true,
              react: {
                runtime: 'automatic',
              },
            },
            keepClassNames: true,
            externalHelpers: true,
            loose: true,
          },
          module: {
            type: 'es6',
          },
          sourceMaps: true,
          swcrc: false,
        },
      ],
    },

    // File extensions to consider
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

    // Test timeout
    testTimeout,

    // Setup files that run after Jest is initialized
    setupFilesAfterEnv: ['@frontmcp/testing/setup'],

    // Transform packages that use ESM
    transformIgnorePatterns: ['node_modules/(?!(jose)/)'],

    // Ignore patterns
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],

    // Coverage settings
    collectCoverage: opts.coverage ?? false,

    // Coverage configuration when enabled
    ...(opts.coverage
      ? {
          coverageDirectory: '<rootDir>/coverage',
          coverageReporters: ['text', 'lcov', 'json'],
          collectCoverageFrom: [
            '<rootDir>/src/**/*.ts',
            '<rootDir>/src/**/*.tsx',
            '!<rootDir>/src/**/*.spec.ts',
            '!<rootDir>/src/**/*.spec.tsx',
          ],
        }
      : {}),

    // Verbose output
    verbose: opts.verbose ?? true,
  };
}

/**
 * Run E2E tests using Jest with auto-injected configuration.
 *
 * Usage:
 *   frontmcp test                    # Run E2E tests in current directory
 *   frontmcp test --runInBand        # Run tests sequentially (recommended for E2E)
 *   frontmcp test --watch            # Run tests in watch mode
 *   frontmcp test --verbose          # Show verbose output
 *   frontmcp test --timeout 60000    # Set test timeout (default: 60000ms)
 */
export async function runTest(opts: ParsedArgs): Promise<void> {
  const cwd = process.cwd();

  // Issue #402: honor an existing `jest.config.{ts,js,mjs,cjs,json}` in cwd
  // by delegating to it instead of injecting our own config. Users who need
  // bespoke behaviour (custom transforms, projects, setup files, …) shouldn't
  // be forced to overlay it on top of our injection.
  const userConfig = await findUserJestConfig(cwd);

  // Issue #402: previously this command HARD-REQUIRED a `./e2e/` directory
  // and exited 1 otherwise — locking out projects that only have colocated
  // unit specs (the CLAUDE.md convention). The new testMatch covers both;
  // we only refuse to run when there's literally nowhere to look.
  const e2eDir = path.join(cwd, 'e2e');
  const srcDir = path.join(cwd, 'src');
  const hasE2EDir = await fileExists(e2eDir);
  const hasSrcDir = await fileExists(srcDir);

  if (!userConfig && !hasE2EDir && !hasSrcDir) {
    console.error(c('red', 'No test sources found.'));
    console.error('');
    console.error('Expected one of:');
    console.error('  • a jest.config.{ts,js,mjs,cjs,json} in the current directory');
    console.error('  • a ./src/ directory with colocated *.spec.ts(x) files');
    console.error('  • a ./e2e/ directory with *.e2e.ts(x) / *.e2e.spec.ts(x) files');
    console.error('');
    console.error('Create one of those, then run:');
    console.error('  frontmcp test');
    process.exit(1);
  }

  // Build Jest arguments. With a user config, we delegate; otherwise we
  // write our generated config to a temp file and point Jest at it.
  let configPath: string | undefined;
  if (!userConfig) {
    const config = generateJestConfig(cwd, opts);
    const tempDir = os.tmpdir();
    configPath = path.join(tempDir, `frontmcp-jest-config-${Date.now()}.json`);
    await writeFile(configPath, JSON.stringify(config, null, 2));
  }

  // Explicit narrowing avoids the non-null assertion on userConfig. By
  // construction, the branch above guarantees that exactly one of
  // `configPath` or `userConfig` is set when we get here — but TS can't
  // see through that flow, so an explicit guard keeps the type checker
  // honest without `!`.
  const selectedConfig = configPath ?? userConfig;
  if (!selectedConfig) {
    // Defensive: should be unreachable thanks to the no-sources check above.
    throw new Error('Internal error: no Jest config selected.');
  }
  // Positional test patterns: everything after the `test` command itself.
  const testPatterns = opts._.slice(1);
  const jestArgs = buildJestArgs(selectedConfig, opts, testPatterns);

  console.log(`${c('cyan', '[test]')} running tests in ${path.relative(process.cwd(), cwd) || '.'}`);
  if (userConfig) {
    console.log(`${c('gray', '[test]')} using user Jest config: ${path.relative(cwd, userConfig)}`);
  } else {
    console.log(`${c('gray', '[test]')} using auto-injected Jest configuration`);
  }

  if (opts.runInBand) {
    console.log(`${c('gray', '[test]')} running tests sequentially (--runInBand)`);
  }

  if (opts.watch) {
    console.log(`${c('gray', '[test]')} watch mode enabled`);
  }

  if (opts.coverage) {
    console.log(`${c('gray', '[test]')} coverage collection enabled`);
  }

  console.log(`${c('gray', 'hint:')} press Ctrl+C to stop\n`);

  // Run Jest directly via node_modules/.bin or npx without shell
  // Using shell: false with explicit args array avoids escaping issues
  const jest = spawn('npx', jestArgs, {
    stdio: 'inherit',
    shell: false,
    cwd,
  });

  // Handle cleanup
  const cleanup = async (proc?: ChildProcess) => {
    try {
      if (proc) {
        proc.kill('SIGINT');
      }
    } catch {
      // ignore
    }
    // Clean up temp config file (only when we generated one — never the user's).
    if (configPath) {
      try {
        await unlink(configPath);
      } catch {
        // ignore
      }
    }
  };

  process.on('SIGINT', () => {
    cleanup(jest).finally(() => {
      process.exit(0);
    });
  });

  // Wait for Jest to complete
  try {
    await new Promise<void>((resolve, reject) => {
      jest.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Jest exited with code ${code}`));
        }
      });
      jest.on('error', (err) => {
        reject(err);
      });
    });
  } finally {
    // Clean up temp config file (only when we generated one — never the user's).
    if (configPath) {
      try {
        await unlink(configPath);
      } catch {
        // ignore
      }
    }
  }
}
