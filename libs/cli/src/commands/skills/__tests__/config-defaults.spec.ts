/**
 * `skills` in frontmcp.config drives `frontmcp skills install` / `export` (#680):
 * `provider`, `install`, `bundle` and `exportTarget` are the defaults; explicit flags win.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Command } from 'commander';

import { loadSkillsDefaults } from '../config-defaults';
import { installSkill } from '../install';
import { registerSkillsCommands } from '../register';

jest.mock('../../../core/version', () => ({ getSelfVersion: () => '1.0.0-test' }));

jest.mock('../catalog', () => ({
  loadCatalog: () => ({
    version: 1,
    skills: [
      {
        name: 'alpha',
        path: 'alpha',
        description: 'Alpha',
        tags: [],
        category: 'dev',
        bundle: ['recommended', 'full'],
      },
      { name: 'beta', path: 'beta', description: 'Beta', tags: [], category: 'dev', bundle: ['full'] },
      { name: 'gamma', path: 'gamma', description: 'Gamma', tags: [], category: 'dev', bundle: ['minimal', 'full'] },
    ],
  }),
  getCatalogDir: () => '/mock/catalog',
}));

const copied: string[] = [];
const copiedTo: string[] = [];
const mockExportSkills = jest.fn(async (_options: { target: string }) => undefined);
jest.mock('../export', () => ({ exportSkills: (options: { target: string }) => mockExportSkills(options) }));
jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return {
    ...actual,
    // The catalog is fake; everything else (the frontmcp.config lookup) is real
    fileExists: jest.fn(async (p: string) => p.startsWith('/mock/catalog/') || actual.fileExists(p)),
    ensureDir: jest.fn(),
    cp: jest.fn(async (_src: string, dest: string) => {
      copied.push(path.basename(dest));
      copiedTo.push(dest);
    }),
    readdir: jest.fn(async () => []),
    readFile: jest.fn(async (p: string) => (p.startsWith('/mock/catalog/') ? '' : actual.readFile(p))),
    writeFile: jest.fn(),
  };
});

class ExitError extends Error {}

describe('installSkill with frontmcp.config selectors', () => {
  beforeEach(() => {
    copied.length = 0;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new ExitError('exit');
    }) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('installs exactly the skills listed in skills.install', async () => {
    await installSkill(undefined, { provider: 'codex', dir: '/tmp/x', names: ['alpha', 'gamma'] });
    expect(copied).toEqual(['alpha', 'gamma']);
  });

  it('refuses names that are not in the catalog, and says which', async () => {
    await expect(
      installSkill(undefined, { provider: 'codex', dir: '/tmp/x', names: ['alpha', 'nope'] }),
    ).rejects.toThrow(ExitError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('nope'));
  });

  it('installs the skills of skills.bundle', async () => {
    await installSkill(undefined, { provider: 'codex', dir: '/tmp/x', bundle: 'minimal' });
    expect(copied).toEqual(['gamma']);
  });

  it("installs nothing for bundle 'none'", async () => {
    await installSkill(undefined, { provider: 'codex', dir: '/tmp/x', bundle: 'none' });
    expect(copied).toEqual([]);
    expect(process.exit).not.toHaveBeenCalled();
  });
});

describe('loadSkillsDefaults', () => {
  let dir: string;
  let cwd: string;
  beforeEach(() => {
    cwd = process.cwd();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-defaults-'));
  });
  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads the skills block of the nearest frontmcp.config', async () => {
    fs.writeFileSync(
      path.join(dir, 'frontmcp.config.json'),
      JSON.stringify({
        name: 'demo',
        deployments: [{ target: 'node' }],
        skills: { provider: 'codex', bundle: 'minimal' },
      }),
    );
    process.chdir(dir);
    expect(await loadSkillsDefaults()).toEqual({ provider: 'codex', bundle: 'minimal' });
  });

  it('is empty without a config', async () => {
    process.chdir(dir);
    expect(await loadSkillsDefaults()).toEqual({});
  });
});

describe('skills install / export take their defaults from frontmcp.config', () => {
  let dir: string;
  let cwd: string;
  beforeEach(() => {
    copied.length = 0;
    cwd = process.cwd();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-register-'));
    fs.writeFileSync(
      path.join(dir, 'frontmcp.config.json'),
      JSON.stringify({
        name: 'demo',
        deployments: [{ target: 'node' }],
        skills: { provider: 'codex', install: ['beta'], exportTarget: 'windsurf' },
      }),
    );
    process.chdir(dir);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.chdir(cwd);
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<void> {
    const program = new Command();
    program.option('--config <path>');
    registerSkillsCommands(program);
    await program.parseAsync(['node', 'frontmcp', ...args]);
  }

  it('`skills install` with no selector installs skills.install with skills.provider', async () => {
    copiedTo.length = 0;
    await run('skills', 'install');
    expect(copied).toEqual(['beta']);
    expect(copiedTo[0]).toContain(path.join('.codex', 'skills', 'beta'));
  });

  it('an explicit --provider wins over skills.provider', async () => {
    copiedTo.length = 0;
    await run('skills', 'install', '--provider', 'claude', '--dir', '/tmp/skills-out');
    expect(copiedTo).toEqual([path.join('/tmp/skills-out', 'beta')]);
  });

  it('`skills export` uses skills.exportTarget unless --target is given', async () => {
    await run('skills', 'export', '--name', 'alpha');
    expect(mockExportSkills).toHaveBeenLastCalledWith(expect.objectContaining({ target: 'windsurf' }));
    await run('skills', 'export', '--name', 'alpha', '--target', 'copilot');
    expect(mockExportSkills).toHaveBeenLastCalledWith(expect.objectContaining({ target: 'copilot' }));
  });

  it('an explicit selector wins over skills.install', async () => {
    await run('skills', 'install', 'alpha');
    expect(copied).toEqual(['alpha']);
  });
});
