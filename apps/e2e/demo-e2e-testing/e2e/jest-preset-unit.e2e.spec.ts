/**
 * A ts-jest CommonJS project that starts from `@frontmcp/testing/jest-preset-unit` boots a server with auth configured
 * in its test process and runs a plugin hook there. The preset compiles `jose`, which Jest's CommonJS runtime cannot
 * load as it ships: the same project without the preset fails with `Unexpected token 'export'`.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const root = join(__dirname, '../../../..');
const fixtureDir = join(__dirname, '../fixture/ts-jest-cjs');
const jestBin = join(root, 'node_modules/jest/bin/jest.js');

function runFixtureJest(config: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [jestBin, '--config', config, '--ci', '--no-cache'], {
    cwd: fixtureDir,
    env: { ...process.env, CI: '1' },
    encoding: 'utf8',
    timeout: 110_000,
  });
  return { status: result.status, output: stripVTControlCharacters(`${result.stdout}${result.stderr}`) };
}

describe('@frontmcp/testing/jest-preset-unit in a ts-jest CommonJS project', () => {
  it('runs a spec that verifies a token with jose and runs a plugin hook in process', () => {
    const { status, output } = runFixtureJest('jest.config.js');

    expect(output).not.toMatch(/Unexpected token 'export'/);
    expect(output).toMatch(/Tests:\s+2 passed, 2 total/);
    expect(status).toBe(0);
  });

  it('is what that project needs: without the preset, Jest cannot load jose', () => {
    const { status, output } = runFixtureJest('jest.without-preset.config.js');

    expect(output).toMatch(/node_modules[/\\]jose[/\\]/);
    expect(output).toMatch(/SyntaxError: Unexpected token 'export'/);
    expect(status).not.toBe(0);
  });
});
