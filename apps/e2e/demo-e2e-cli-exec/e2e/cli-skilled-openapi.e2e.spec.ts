/**
 * E2E: a CLI built for a server whose skills a plugin registers at runtime (a Skilled OpenAPI bundle). A one-shot
 * command sees those skills, `skills read` / `skills load` exit 1 for a skill they do not find, and a running daemon
 * serves the commands from the bundle it loaded once.
 */
import * as os from 'node:os';
import * as path from 'node:path';

import { mkdtemp, rename, rm } from '@frontmcp/utils';

import { removeScratchProject } from './helpers/dev-cli';
import { runCliBundle, type CliResult } from './helpers/exec-cli';
import { buildSkilledCliProject, type SkilledCliProject } from './helpers/skilled-cli-project';

const APP_NAME = 'skilled-cli-demo';

describe('a CLI whose skills a plugin registers at runtime', () => {
  let project: SkilledCliProject;
  let homeDir: string;

  function run(args: string[]): CliResult {
    return runCliBundle(project.cliBundle, args, { FRONTMCP_HOME: homeDir });
  }

  beforeAll(async () => {
    project = await buildSkilledCliProject({ prefix: 'skilled-cli', appName: APP_NAME });
    // Short: the daemon's socket path must fit the platform's limit
    homeDir = await mkdtemp(path.join(os.tmpdir(), 'fmcp-sk-'));
  }, 180_000);

  afterAll(async () => {
    run(['daemon', 'stop']);
    await rm(homeDir, { recursive: true, force: true });
    await removeScratchProject(project.dir);
  });

  it('lists the bundle skills', () => {
    const { stdout, exitCode } = run(['skills', 'list']);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Invoices');
  });

  it('searches the bundle skills', () => {
    const { stdout, exitCode } = run(['skills', 'search', 'invoices']);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Invoices');
  });

  it("reads a bundle skill's SKILL.md resource", () => {
    const { stdout, exitCode } = run(['resource', 'read', 'skill://Invoices/SKILL.md']);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('name: Invoices');
    expect(stdout).toContain('Find an invoice by its id.');
  });

  it('loads a bundle skill', () => {
    const { stdout, exitCode } = run(['skills', 'load', 'invoices']);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Loaded 1 of 1 skill(s).');
  });

  it('exits 1 from skills load when a skill is not found, and names it', () => {
    const { stdout, stderr, exitCode } = run(['skills', 'load', 'invoices', 'refunds']);

    expect(exitCode).toBe(1);
    expect(stdout).toContain('Loaded 1 of 2 skill(s).');
    expect(stderr).toContain('Skill "refunds" not found');
  });

  it('exits 1 from skills read when the skill is not found', () => {
    const { stdout, stderr, exitCode } = run(['skills', 'read', 'refunds']);

    expect(exitCode).toBe(1);
    expect(stdout).not.toContain('Loaded');
    expect(stderr).toContain('Skill "refunds" not found.');
  });

  it('exits 1 from skills read --output json when the skill is not found', () => {
    const { stdout, exitCode } = run(['--output', 'json', 'skills', 'read', 'refunds']);

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({ skills: [] });
  });

  describe('with its daemon running', () => {
    const movedBundlePath = () => `${project.bundlePath}.moved`;

    beforeAll(() => {
      expect(run(['daemon', 'start'])).toMatchObject({ exitCode: 0 });
    });

    afterAll(async () => {
      run(['daemon', 'stop']);
      await rename(movedBundlePath(), project.bundlePath).catch(() => undefined);
    });

    it('serves the commands from the bundle it loaded, after the file is gone', async () => {
      expect(run(['skills', 'list']).stdout).toContain('Invoices');
      // An in-process command reads the bundle file at start; only the daemon still has the bundle
      await rename(project.bundlePath, movedBundlePath());

      expect(run(['skills', 'list'])).toMatchObject({ exitCode: 0, stdout: expect.stringContaining('Invoices') });
      expect(run(['resource', 'read', 'skill://Invoices/SKILL.md']).stdout).toContain('name: Invoices');
      expect(run(['search-skill', '--query', 'invoices']).stdout).toContain('invoices');
    });

    it('leaves a command without the daemon to read the bundle itself', () => {
      expect(run(['daemon', 'stop'])).toMatchObject({ exitCode: 0 });

      expect(run(['skills', 'list']).stdout).not.toContain('Invoices');
    });
  });
});
