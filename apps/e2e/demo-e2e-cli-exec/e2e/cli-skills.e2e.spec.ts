/**
 * E2E tests for `frontmcp skills` CLI commands: list, search, install.
 *
 * Runs the actual frontmcp CLI binary against the real @frontmcp/skills catalog.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { runFrontmcpCli } from './helpers/exec-cli';

describe('CLI Skills Commands', () => {
  // ─── skills list ────────────────────────────────────────────────────────────

  describe('skills list', () => {
    it('should list all skills with exit code 0', () => {
      const { stdout, exitCode } = runFrontmcpCli(['skills', 'list']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Skills Catalog');
    });

    it('should include known skill names', () => {
      const { stdout } = runFrontmcpCli(['skills', 'list']);
      expect(stdout).toContain('frontmcp-setup');
      expect(stdout).toContain('frontmcp-deployment');
      expect(stdout).toContain('frontmcp-development');
    });

    it('should filter by category', () => {
      const { stdout, exitCode } = runFrontmcpCli(['skills', 'list', '--category', 'setup']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('frontmcp-setup');
      // Should NOT include deployment skills
      expect(stdout).not.toContain('frontmcp-deployment');
      expect(stdout).not.toContain('frontmcp-development');
    });

    it('should filter by tag', () => {
      const { stdout, exitCode } = runFrontmcpCli(['skills', 'list', '--tag', 'redis']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('frontmcp-setup');
    });

    it('should filter by bundle', () => {
      const { stdout, exitCode } = runFrontmcpCli(['skills', 'list', '--bundle', 'minimal']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('frontmcp-setup');
      // Skills not in minimal bundle should be excluded
      expect(stdout).not.toContain('frontmcp-guides');
    });
  });

  // ─── skills search ──────────────────────────────────────────────────────────

  describe('skills search', () => {
    it('should return results for a keyword query', () => {
      const { stdout, exitCode } = runFrontmcpCli(['skills', 'search', 'redis']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('frontmcp-config');
      expect(stdout).toContain('result(s)');
    });

    it('should return results for a multi-word query', () => {
      const { stdout, exitCode } = runFrontmcpCli(['skills', 'search', 'deploy serverless']);
      expect(exitCode).toBe(0);
      // Should match the deployment router
      expect(stdout).toContain('frontmcp-deployment');
    });

    it('should respect --limit option', () => {
      const { stdout, exitCode } = runFrontmcpCli(['skills', 'search', 'setup', '--limit', '2']);
      expect(exitCode).toBe(0);
      // Count result entries (lines with score: pattern)
      const resultLines = stdout.split('\n').filter((line) => line.includes('score:'));
      expect(resultLines.length).toBeLessThanOrEqual(2);
    });

    it('should respect --category filter', () => {
      const { stdout, exitCode } = runFrontmcpCli(['skills', 'search', 'configure', '--category', 'config']);
      expect(exitCode).toBe(0);
      // Results should only be from config category
      if (stdout.includes('result(s)')) {
        expect(stdout).toContain('[config]');
        expect(stdout).not.toContain('[setup]');
      }
    });

    it('should show no-results message for nonsense query', () => {
      const { stdout, exitCode } = runFrontmcpCli(['skills', 'search', 'xyznonexistent123']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('No skills found');
    });
  });

  // ─── skills install ─────────────────────────────────────────────────────────

  describe('skills install', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-skills-e2e-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should install a skill to a custom directory', () => {
      // Runs in tmpDir so a regression in the CLAUDE.md rule never touches the repo's own CLAUDE.md.
      const { stdout, exitCode } = runFrontmcpCli(
        ['skills', 'install', 'frontmcp-setup', '--dir', tmpDir],
        undefined,
        tmpDir,
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Installed');
      expect(stdout).toContain('frontmcp-setup');

      // Verify SKILL.md was copied
      const skillMd = path.join(tmpDir, 'frontmcp-setup', 'SKILL.md');
      expect(fs.existsSync(skillMd)).toBe(true);

      // Verify content is non-empty
      const content = fs.readFileSync(skillMd, 'utf-8');
      expect(content.length).toBeGreaterThan(100);
      expect(content).toContain('frontmcp-setup');
    });

    it('should install a skill that has resources', () => {
      const { stdout, exitCode } = runFrontmcpCli(
        ['skills', 'install', 'frontmcp-deployment', '--dir', tmpDir],
        undefined,
        tmpDir,
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Installed');

      // frontmcp-deployment has hasResources: true — verify references/ was copied
      const skillDir = path.join(tmpDir, 'frontmcp-deployment');
      expect(fs.existsSync(path.join(skillDir, 'SKILL.md'))).toBe(true);
      const refDir = path.join(skillDir, 'references');
      expect(fs.existsSync(refDir)).toBe(true);
    });

    it('should error on unknown skill name', () => {
      const { stdout, stderr, exitCode } = runFrontmcpCli(
        ['skills', 'install', 'nonexistent-skill-xyz', '--dir', tmpDir],
        undefined,
        tmpDir,
      );
      expect(exitCode).not.toBe(0);
      const output = stdout + stderr;
      expect(output.toLowerCase()).toContain('not found');
    });

    it('should install to directory specified by --dir', () => {
      const baseDir = path.join(tmpDir, 'project');
      fs.mkdirSync(baseDir, { recursive: true });

      const { exitCode } = runFrontmcpCli(
        ['skills', 'install', 'frontmcp-setup', '--provider', 'claude', '--dir', baseDir],
        undefined,
        tmpDir,
      );
      expect(exitCode).toBe(0);

      // Should exist under the base dir
      const skillMd = path.join(baseDir, 'frontmcp-setup', 'SKILL.md');
      expect(fs.existsSync(skillMd)).toBe(true);
    });

    it('updates the CLAUDE.md of the project that owns a --dir ending in .claude/skills', () => {
      const cwd = path.join(tmpDir, 'current');
      const otherProject = path.join(tmpDir, 'other-project');
      fs.mkdirSync(cwd, { recursive: true });

      const { exitCode } = runFrontmcpCli(
        ['skills', 'install', 'frontmcp-setup', '--dir', path.join(otherProject, '.claude', 'skills')],
        undefined,
        cwd,
      );
      expect(exitCode).toBe(0);
      expect(fs.existsSync(path.join(cwd, 'CLAUDE.md'))).toBe(false);
      expect(fs.readFileSync(path.join(otherProject, 'CLAUDE.md'), 'utf-8')).toContain('**frontmcp-setup**');
    });

    it('leaves CLAUDE.md alone for any other --dir and prints the block to add', () => {
      const customDir = path.join(tmpDir, 'custom-skills');
      const { stdout, exitCode } = runFrontmcpCli(
        ['skills', 'install', 'frontmcp-setup', '--dir', customDir],
        undefined,
        tmpDir,
      );
      expect(exitCode).toBe(0);
      expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(false);
      expect(stdout).toContain("is not a project's .claude/skills folder");
      expect(stdout).toContain('<!-- frontmcp:skills-start');
    });

    it('--no-claude-md neither writes a CLAUDE.md nor prints the block', () => {
      const { stdout, exitCode } = runFrontmcpCli(
        ['skills', 'install', 'frontmcp-setup', '--no-claude-md'],
        undefined,
        tmpDir,
      );
      expect(exitCode).toBe(0);
      expect(fs.existsSync(path.join(tmpDir, '.claude', 'skills', 'frontmcp-setup', 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(false);
      expect(stdout).not.toContain('<!-- frontmcp:skills-start');
    });
  });
});
