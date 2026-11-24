/**
 * `frontmcp skills export --target cursor|windsurf|copilot` writes rule files that may be links, as long as they lead
 * inside the project (#1304): a link, or a linked folder above the file, that leads outside is refused by name.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { exportSkills } from '../export';

const posixOnly = process.platform === 'win32' ? describe.skip : describe;

let catalogDir: string;

jest.mock('../catalog', () => ({
  loadCatalog: () => ({
    skills: [{ name: 'demo', description: 'A demo skill', path: 'demo', category: 'setup', tags: [] }],
  }),
  getCatalogDir: () => catalogDir,
}));

posixOnly('exportSkills with linked rule files', () => {
  let scratch: string;
  let project: string;
  let outside: string;
  let exit: jest.SpyInstance;
  let errors: jest.SpyInstance;

  beforeEach(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-skills-export-')));
    catalogDir = path.join(scratch, 'catalog');
    project = path.join(scratch, 'project');
    outside = path.join(scratch, 'outside');
    fs.mkdirSync(path.join(catalogDir, 'demo'), { recursive: true });
    fs.writeFileSync(path.join(catalogDir, 'demo', 'SKILL.md'), '---\nname: demo\n---\nUse the demo skill.\n');
    fs.mkdirSync(path.join(project, '.git'), { recursive: true });
    fs.mkdirSync(outside);
    exit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  const exportDemo = (target: 'cursor' | 'windsurf' | 'copilot', outDir = project) =>
    exportSkills({ target, name: 'demo', outDir });

  it('writes a rule file that is not a link', async () => {
    await exportDemo('cursor');

    expect(fs.readFileSync(path.join(project, '.cursor/rules/demo.mdc'), 'utf8')).toContain('Use the demo skill.');
  });

  it('writes through a link that leads inside the repository, and keeps the link', async () => {
    fs.mkdirSync(path.join(project, '.github/instructions'), { recursive: true });
    fs.mkdirSync(path.join(project, 'shared'));
    fs.symlinkSync(path.join(project, 'shared/AGENTS.md'), path.join(project, '.github/instructions/demo.md'));
    fs.writeFileSync(path.join(project, 'shared/AGENTS.md'), 'old');

    await exportDemo('copilot');

    expect(fs.lstatSync(path.join(project, '.github/instructions/demo.md')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(project, 'shared/AGENTS.md'), 'utf8')).toContain('Use the demo skill.');
  });

  it('keeps the permissions of a rule file it replaces', async () => {
    fs.mkdirSync(path.join(project, '.cursor/rules'), { recursive: true });
    fs.writeFileSync(path.join(project, '.cursor/rules/demo.mdc'), 'old', { mode: 0o600 });
    fs.chmodSync(path.join(project, '.cursor/rules/demo.mdc'), 0o600);

    await exportDemo('cursor');

    const replaced = fs.statSync(path.join(project, '.cursor/rules/demo.mdc'));
    expect(replaced.mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(path.join(project, '.cursor/rules/demo.mdc'), 'utf8')).toContain('Use the demo skill.');
  });

  it('merges into a linked .windsurfrules inside the repository', async () => {
    fs.writeFileSync(path.join(project, 'RULES.md'), '## other\nKeep me.\n');
    fs.symlinkSync(path.join(project, 'RULES.md'), path.join(project, '.windsurfrules'));

    await exportDemo('windsurf');

    const merged = fs.readFileSync(path.join(project, 'RULES.md'), 'utf8');
    expect(merged).toContain('Keep me.');
    expect(merged).toContain('Use the demo skill.');
  });

  it('refuses a rule file that links outside the repository, and writes nothing there', async () => {
    fs.mkdirSync(path.join(project, '.cursor/rules'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'notes.md'), 'untouched');
    fs.symlinkSync(path.join(outside, 'notes.md'), path.join(project, '.cursor/rules/demo.mdc'));

    await expect(exportDemo('cursor')).rejects.toThrow('process.exit(1)');

    expect(exit).toHaveBeenCalledWith(1);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('Not writing .cursor/rules/demo.mdc'));
    expect(fs.readFileSync(path.join(outside, 'notes.md'), 'utf8')).toBe('untouched');
  });

  it('refuses a folder above the rule file that links outside the repository', async () => {
    fs.symlinkSync(outside, path.join(project, '.github'));

    await expect(exportDemo('copilot', path.join(project, '.github'))).rejects.toThrow('process.exit(1)');

    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('does not take a checkout that a linked output folder leads to for the project', async () => {
    const otherCheckout = path.join(outside, 'checkout');
    fs.mkdirSync(path.join(otherCheckout, '.git'), { recursive: true });
    fs.symlinkSync(otherCheckout, path.join(project, 'linked-out'));

    await expect(exportDemo('cursor', path.join(project, 'linked-out'))).rejects.toThrow('process.exit(1)');

    expect(fs.existsSync(path.join(otherCheckout, '.cursor'))).toBe(false);
  });

  it('refuses a rule file that links to a missing file', async () => {
    fs.mkdirSync(path.join(project, '.cursor/rules'), { recursive: true });
    fs.symlinkSync(path.join(outside, 'missing.md'), path.join(project, '.cursor/rules/demo.mdc'));

    await expect(exportDemo('cursor')).rejects.toThrow('process.exit(1)');

    expect(fs.existsSync(path.join(outside, 'missing.md'))).toBe(false);
  });

  it('outside a repository, keeps the writes inside the output folder', async () => {
    const plain = path.join(scratch, 'plain');
    fs.mkdirSync(path.join(plain, '.cursor/rules'), { recursive: true });
    fs.symlinkSync(path.join(outside, 'notes.md'), path.join(plain, '.cursor/rules/demo.mdc'));
    fs.writeFileSync(path.join(outside, 'notes.md'), 'untouched');

    await expect(exportDemo('cursor', plain)).rejects.toThrow('process.exit(1)');

    expect(fs.readFileSync(path.join(outside, 'notes.md'), 'utf8')).toBe('untouched');
  });
});
