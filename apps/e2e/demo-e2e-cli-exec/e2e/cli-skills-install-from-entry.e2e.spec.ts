/**
 * E2E coverage for issue #415 — `frontmcp skills install --from-entry`.
 *
 * Drives the dev-tool CLI against the cli-exec-demo fixture. Its entry imports
 * external packages the way every real project does, so extraction only works
 * if the temporary bundle can resolve them from the project at runtime.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getFixtureDir, runFrontmcpCli } from './helpers/exec-cli';

describe('frontmcp skills install --from-entry (issue #415)', () => {
  let targetDir: string;

  beforeAll(() => {
    targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-415-from-entry-'));
  });

  afterAll(() => {
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it('installs every @Skill with its instructions, whether file-based or inline', () => {
    const { stderr, exitCode } = runFrontmcpCli(
      ['skills', 'install', '--from-entry', 'src/main.ts', '--all', '--provider', 'codex', '--dir', targetDir],
      undefined,
      getFixtureDir(),
    );
    expect(stderr).not.toContain('Could not enumerate');
    expect(exitCode).toBe(0);

    const greetingMd = fs.readFileSync(path.join(targetDir, 'greeting-helper', 'SKILL.md'), 'utf8');
    expect(greetingMd).toContain('description: A helper skill for greeting users');
    expect(greetingMd).toContain('## Greeting Guide');

    const mathMd = fs.readFileSync(path.join(targetDir, 'math-helper', 'SKILL.md'), 'utf8');
    expect(mathMd).toContain('name: math-helper');
    expect(mathMd).toContain('## Math Helper');
  });

  it('leaves no bundling scratch directory behind in the project', () => {
    const leftovers = fs.readdirSync(getFixtureDir()).filter((entry) => entry.startsWith('.frontmcp-'));
    expect(leftovers).toEqual([]);
  });
});
