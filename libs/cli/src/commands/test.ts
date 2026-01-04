import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { ParsedArgs } from '../args';
import { c } from '../colors';
import { fileExists } from '@frontmcp/utils';
import { fsp } from '../utils/fs';

/**
 * Generate Jest configuration programmatically for E2E tests.
 * This eliminates the need for projects to have their own jest.e2e.config.ts.
 */
function generateJestConfig(cwd: string, opts: ParsedArgs): object {
  const testTimeout = opts.timeout ?? 60000;

  return {
    // Use Node.js environment for E2E tests
    testEnvironment: 'node',

    // Root directory for tests
    rootDir: cwd,

    // Test file patterns for E2E tests
    testMatch: ['<rootDir>/e2e/**/*.e2e.ts', '<rootDir>/e2e/**/*.e2e.test.ts', '<rootDir>/**/*.e2e.ts'],

    // Transform TypeScript files using @swc/jest for speed
    transform: {
      '^.+\\.[tj]s$': [
        '@swc/jest',
        {
          jsc: {
            target: 'es2022',
            parser: {
              syntax: 'typescript',
              decorators: true,
              dynamicImport: true,
            },
            transform: {
              decoratorMetadata: true,
              legacyDecorator: true,
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
          collectCoverageFrom: ['<rootDir>/src/**/*.ts', '!<rootDir>/src/**/*.test.ts', '!<rootDir>/src/**/*.spec.ts'],
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

  // Check for e2e directory
  const e2eDir = path.join(cwd, 'e2e');
  const hasE2EDir = await fileExists(e2eDir);

  if (!hasE2EDir) {
    console.error(c('red', 'No e2e directory found.'));
    console.error('');
    console.error('Expected structure:');
    console.error('  ./e2e/');
    console.error('    ├── your-test.e2e.ts');
    console.error('    └── another-test.e2e.test.ts');
    console.error('');
    console.error('Create an e2e directory with test files, then run:');
    console.error('  frontmcp test');
    process.exit(1);
  }

  // Generate Jest config and write to temp file
  const config = generateJestConfig(cwd, opts);
  const tempDir = os.tmpdir();
  const configPath = path.join(tempDir, `frontmcp-jest-config-${Date.now()}.json`);
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2));

  // Build Jest arguments
  const jestArgs: string[] = ['jest', '--config', configPath];

  // Add --runInBand for sequential execution (recommended for E2E tests)
  if (opts.runInBand) {
    jestArgs.push('--runInBand');
  }

  // Add watch mode
  if (opts.watch) {
    jestArgs.push('--watch');
  }

  // Add verbose flag
  if (opts.verbose) {
    jestArgs.push('--verbose');
  }

  // Add coverage flag
  if (opts.coverage) {
    jestArgs.push('--coverage');
  }

  // Add any additional positional args (e.g., test file patterns)
  const testPatterns = opts._.slice(1); // Skip 'test' command itself
  if (testPatterns.length > 0) {
    jestArgs.push(...testPatterns);
  }

  console.log(`${c('cyan', '[test]')} running E2E tests in ${path.relative(process.cwd(), cwd) || '.'}`);
  console.log(`${c('gray', '[test]')} using auto-injected Jest configuration`);

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
    // Clean up temp config file
    try {
      await fsp.unlink(configPath);
    } catch {
      // ignore
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
    // Clean up temp config file
    try {
      await fsp.unlink(configPath);
    } catch {
      // ignore
    }
  }
}
