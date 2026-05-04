import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  FilesystemSkillsSource,
  loadFilesystemSkill,
  parseSkillFrontmatter,
  type FilesystemSkillsEvent,
  type FilesystemSkillsLogger,
} from '../sources/filesystem-skills.source';

const noopLogger: FilesystemSkillsLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

async function mkTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'fs-skills-'));
}

async function writeSkill(
  rootDir: string,
  name: string,
  frontmatter: Record<string, string>,
  body: string,
): Promise<string> {
  const dir = path.join(rootDir, name);
  await fs.mkdir(dir, { recursive: true });
  const fmLines = ['---'];
  for (const [k, v] of Object.entries(frontmatter)) fmLines.push(`${k}: ${v}`);
  fmLines.push('---');
  fmLines.push('');
  fmLines.push(body);
  await fs.writeFile(path.join(dir, 'SKILL.md'), fmLines.join('\n'));
  return dir;
}

describe('parseSkillFrontmatter', () => {
  it('parses key/value frontmatter and body', () => {
    const raw = '---\nname: review-pr\ndescription: Review a PR\n---\n# Body content\nDo a review.\n';
    const { frontmatter, body } = parseSkillFrontmatter(raw);
    expect(frontmatter['name']).toBe('review-pr');
    expect(frontmatter['description']).toBe('Review a PR');
    expect(body.trim()).toMatch(/^# Body content/);
  });

  it('parses inline list (comma-separated) and block list', () => {
    const inline = parseSkillFrontmatter('---\ntools: a, b, c\n---\nBody');
    expect(inline.frontmatter['tools']).toBe('a, b, c');

    const block = parseSkillFrontmatter('---\ntools:\n- a\n- b\n---\nBody');
    expect(block.frontmatter['tools']).toEqual(['a', 'b']);
  });

  it('returns empty frontmatter when not present', () => {
    const { frontmatter, body } = parseSkillFrontmatter('Just a body, no frontmatter\n');
    expect(frontmatter).toEqual({});
    expect(body).toMatch(/^Just a body/);
  });

  it('strips quotes from quoted values', () => {
    const { frontmatter } = parseSkillFrontmatter('---\nname: "quoted name"\n---\nbody');
    expect(frontmatter['name']).toBe('quoted name');
  });
});

describe('loadFilesystemSkill', () => {
  it('reads a skill directory into FilesystemSkillContent', async () => {
    const root = await mkTempDir();
    try {
      const dir = await writeSkill(
        root,
        'pizza',
        { name: 'pizza', description: 'Order pizza' },
        '# Order pizza\nDo it.',
      );
      const content = await loadFilesystemSkill(dir);
      expect(content).toMatchObject({
        id: 'pizza',
        name: 'pizza',
        description: 'Order pizza',
      });
      expect(content.instructions).toMatch(/^# Order pizza/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('throws when description is missing', async () => {
    const root = await mkTempDir();
    try {
      const dir = await writeSkill(root, 's1', { name: 's1' }, '# Body');
      await expect(loadFilesystemSkill(dir)).rejects.toThrow(/description/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('detects scripts/ references/ examples/ assets/ subdirectories', async () => {
    const root = await mkTempDir();
    try {
      const dir = await writeSkill(root, 's1', { name: 's1', description: 'd' }, '# Body');
      for (const sub of ['scripts', 'references', 'examples', 'assets']) {
        await fs.mkdir(path.join(dir, sub), { recursive: true });
      }
      const content = await loadFilesystemSkill(dir);
      expect(content.resources?.scripts).toBe(path.join(dir, 'scripts'));
      expect(content.resources?.references).toBe(path.join(dir, 'references'));
      expect(content.resources?.examples).toBe(path.join(dir, 'examples'));
      expect(content.resources?.assets).toBe(path.join(dir, 'assets'));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('FilesystemSkillsSource', () => {
  it('emits an upsert per skill on initial scan', async () => {
    const root = await mkTempDir();
    try {
      await writeSkill(root, 'a', { name: 'a', description: 'A' }, '# A\nbody-a');
      await writeSkill(root, 'b', { name: 'b', description: 'B' }, '# B\nbody-b');
      const events: FilesystemSkillsEvent[] = [];
      const source = new FilesystemSkillsSource({ skillsDir: root, watch: false }, noopLogger);
      source.onChange((e) => events.push(e));
      await source.start();
      await source.stop();

      const ids = events.filter((e) => e.op === 'upsert').map((e) => (e as { skill: { id: string } }).skill.id);
      expect(ids.sort()).toEqual(['a', 'b']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('skips directories whose SKILL.md is invalid (no description)', async () => {
    const root = await mkTempDir();
    try {
      await writeSkill(root, 'good', { name: 'good', description: 'D' }, '# Body');
      await writeSkill(root, 'bad', { name: 'bad' }, '# Body'); // no description
      const events: FilesystemSkillsEvent[] = [];
      const source = new FilesystemSkillsSource({ skillsDir: root, watch: false }, noopLogger);
      source.onChange((e) => events.push(e));
      await source.start();
      await source.stop();

      const upsertIds = events.filter((e) => e.op === 'upsert').map((e) => (e as { skill: { id: string } }).skill.id);
      expect(upsertIds).toEqual(['good']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('skips dotfiles in skillsDir (editor swap files, etc.)', async () => {
    const root = await mkTempDir();
    try {
      await writeSkill(root, '.hidden', { name: '.hidden', description: 'D' }, '# Body');
      await writeSkill(root, 'visible', { name: 'visible', description: 'D' }, '# Body');
      const events: FilesystemSkillsEvent[] = [];
      const source = new FilesystemSkillsSource({ skillsDir: root, watch: false }, noopLogger);
      source.onChange((e) => events.push(e));
      await source.start();
      await source.stop();
      const ids = events.filter((e) => e.op === 'upsert').map((e) => (e as { skill: { id: string } }).skill.id);
      expect(ids).toEqual(['visible']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('does not re-emit upsert when content is unchanged on refresh', async () => {
    const root = await mkTempDir();
    try {
      await writeSkill(root, 'a', { name: 'a', description: 'D' }, '# Body');
      const events: FilesystemSkillsEvent[] = [];
      const source = new FilesystemSkillsSource({ skillsDir: root, watch: false }, noopLogger);
      source.onChange((e) => events.push(e));
      await source.start();

      // Trigger a refresh by force — same content should not re-emit.
      // refreshSkill is private; exercise indirectly via pollOnce equivalent.
      await (source as unknown as { pollOnce: () => Promise<void> }).pollOnce();

      await source.stop();
      const upserts = events.filter((e) => e.op === 'upsert');
      expect(upserts).toHaveLength(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('emits delete when a skill subdirectory disappears', async () => {
    const root = await mkTempDir();
    try {
      const aDir = await writeSkill(root, 'a', { name: 'a', description: 'D' }, '# Body');
      const events: FilesystemSkillsEvent[] = [];
      const source = new FilesystemSkillsSource({ skillsDir: root, watch: false }, noopLogger);
      source.onChange((e) => events.push(e));
      await source.start();

      // Delete the dir, then re-poll.
      await fs.rm(aDir, { recursive: true, force: true });
      await (source as unknown as { pollOnce: () => Promise<void> }).pollOnce();
      await source.stop();

      const ops = events.map((e) => e.op);
      expect(ops).toContain('upsert');
      expect(ops).toContain('delete');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('emits upsert when SKILL.md content changes', async () => {
    const root = await mkTempDir();
    try {
      const dir = await writeSkill(root, 'a', { name: 'a', description: 'D' }, '# Body');
      const events: FilesystemSkillsEvent[] = [];
      const source = new FilesystemSkillsSource({ skillsDir: root, watch: false }, noopLogger);
      source.onChange((e) => events.push(e));
      await source.start();

      // Modify content, then poll.
      await fs.writeFile(path.join(dir, 'SKILL.md'), '---\nname: a\ndescription: D2\n---\n# Body 2\nNew body');
      await (source as unknown as { pollOnce: () => Promise<void> }).pollOnce();
      await source.stop();

      const upserts = events.filter((e) => e.op === 'upsert') as Array<{
        op: 'upsert';
        skill: { description: string; instructions: string };
      }>;
      expect(upserts).toHaveLength(2);
      expect(upserts[1].skill.description).toBe('D2');
      expect(upserts[1].skill.instructions).toMatch(/Body 2/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('handles missing skillsDir gracefully (warns, emits nothing)', async () => {
    const events: FilesystemSkillsEvent[] = [];
    const warn = jest.fn();
    const source = new FilesystemSkillsSource(
      { skillsDir: '/nonexistent/path/that/does/not/exist', watch: false },
      { ...noopLogger, warn },
    );
    source.onChange((e) => events.push(e));
    await source.start();
    await source.stop();
    expect(events).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });
});
