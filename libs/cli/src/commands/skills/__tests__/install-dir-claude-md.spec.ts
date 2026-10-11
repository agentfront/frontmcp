import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { installSkill } from '../install';

describe('skills install --dir and CLAUDE.md', () => {
  let workDir: string;
  let currentProject: string;
  let stdout: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-skills-dir-'));
    currentProject = path.join(workDir, 'current-project');
    fs.mkdirSync(currentProject, { recursive: true });
    process.chdir(currentProject);
    stdout = '';
    jest.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
      stdout += `${parts.map(String).join(' ')}\n`;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.chdir(originalCwd);
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('updates the CLAUDE.md of the project that owns <dir>/.claude/skills, not the current directory', async () => {
    const otherProject = path.join(workDir, 'other-project');
    await installSkill('frontmcp-setup', { dir: path.join(otherProject, '.claude', 'skills') });

    expect(fs.existsSync(path.join(currentProject, 'CLAUDE.md'))).toBe(false);
    const claudeMd = fs.readFileSync(path.join(otherProject, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('**frontmcp-setup**');
  });

  it('accepts a relative <dir> that ends in .claude/skills', async () => {
    await installSkill('frontmcp-setup', { dir: '../other-project/.claude/skills' });

    expect(fs.existsSync(path.join(currentProject, 'CLAUDE.md'))).toBe(false);
    expect(fs.readFileSync(path.join(workDir, 'other-project', 'CLAUDE.md'), 'utf8')).toContain('**frontmcp-setup**');
  });

  it('leaves every CLAUDE.md alone for any other <dir>, and prints the block to add', async () => {
    const customDir = path.join(workDir, 'custom-skills');
    await installSkill('frontmcp-setup', { dir: customDir });

    expect(fs.existsSync(path.join(currentProject, 'CLAUDE.md'))).toBe(false);
    expect(fs.existsSync(path.join(workDir, 'CLAUDE.md'))).toBe(false);
    expect(stdout).toContain(`${customDir} is not a project's .claude/skills folder`);
    expect(stdout).toContain('<!-- frontmcp:skills-start');
    expect(stdout).toContain(`installed in \`${customDir}\``);
    expect(stdout).toContain('**frontmcp-setup**');
  });

  it("still updates the current directory's CLAUDE.md without --dir", async () => {
    await installSkill('frontmcp-setup', {});

    expect(fs.readFileSync(path.join(currentProject, 'CLAUDE.md'), 'utf8')).toContain('**frontmcp-setup**');
  });

  it('with claudeMd: false (--no-claude-md) neither writes a CLAUDE.md nor prints the block', async () => {
    await installSkill('frontmcp-setup', { claudeMd: false });
    await installSkill('frontmcp-setup', { dir: path.join(workDir, 'custom-skills'), claudeMd: false });

    expect(fs.existsSync(path.join(currentProject, 'CLAUDE.md'))).toBe(false);
    expect(stdout).not.toContain('<!-- frontmcp:skills-start');
  });
});
