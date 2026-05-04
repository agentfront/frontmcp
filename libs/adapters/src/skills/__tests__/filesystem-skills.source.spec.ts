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

  it('rejects symlinks whose realpath escapes skillsDir', async () => {
    const root = await mkTempDir();
    const outside = await mkTempDir();
    const warn = jest.fn();
    try {
      // Inside `outside`, prepare a fully-formed skill that we'll point a
      // symlink to. Without the realpath check, the source would happily
      // load it as if it lived inside skillsDir.
      const realSkillDir = path.join(outside, 'evil-skill');
      await fs.mkdir(realSkillDir, { recursive: true });
      await fs.writeFile(path.join(realSkillDir, 'SKILL.md'), '---\nname: evil\ndescription: D\n---\n# Body\n');
      // Symlink inside skillsDir → outside dir
      await fs.symlink(realSkillDir, path.join(root, 'evil-skill'));
      // Plus a normal sibling skill so we know the source still works.
      await writeSkill(root, 'good', { name: 'good', description: 'D' }, '# Body');

      const events: FilesystemSkillsEvent[] = [];
      const source = new FilesystemSkillsSource({ skillsDir: root, watch: false }, { ...noopLogger, warn });
      source.onChange((e) => events.push(e));
      await source.start();
      await source.stop();

      const ids = events.filter((e) => e.op === 'upsert').map((e) => (e as { skill: { id: string } }).skill.id);
      expect(ids).toEqual(['good']);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/realpath escapes skillsDir/));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('skips broken symlinks without throwing', async () => {
    const root = await mkTempDir();
    try {
      await writeSkill(root, 'good', { name: 'good', description: 'D' }, '# Body');
      await fs.symlink(path.join(root, 'does-not-exist'), path.join(root, 'broken'));
      const events: FilesystemSkillsEvent[] = [];
      const source = new FilesystemSkillsSource({ skillsDir: root, watch: false }, noopLogger);
      source.onChange((e) => events.push(e));
      await source.start();
      await source.stop();
      const ids = events.filter((e) => e.op === 'upsert').map((e) => (e as { skill: { id: string } }).skill.id);
      expect(ids).toEqual(['good']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('isolates listener errors so a bad subscriber does not break others', async () => {
    const root = await mkTempDir();
    const warn = jest.fn();
    try {
      await writeSkill(root, 'a', { name: 'a', description: 'D' }, '# Body');
      const seen: string[] = [];
      const source = new FilesystemSkillsSource({ skillsDir: root, watch: false }, { ...noopLogger, warn });
      source.onChange(() => {
        throw new Error('listener-boom');
      });
      const unsubscribe = source.onChange((e) => {
        if (e.op === 'upsert') seen.push(e.skill.id);
      });
      await source.start();
      await source.stop();
      expect(seen).toEqual(['a']);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/listener threw/));
      // Calling the unsubscribe function after stop() must be safe.
      unsubscribe();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('emits upsert from fs.watch when SKILL.md changes (watch=true)', async () => {
    const root = await mkTempDir();
    try {
      const dir = await writeSkill(root, 'a', { name: 'a', description: 'D' }, '# Body');
      const events: FilesystemSkillsEvent[] = [];
      const source = new FilesystemSkillsSource(
        { skillsDir: root, watch: true, debounceMs: 30, pollIntervalMs: 60 },
        noopLogger,
      );
      source.onChange((e) => events.push(e));
      await source.start();
      // Wait for initial-scan upsert.
      await new Promise((r) => setTimeout(r, 50));
      // Mutate the file — fs.watch may or may not deliver a change on every
      // platform/CI runner, so we also force a poll to keep the test stable.
      await fs.writeFile(path.join(dir, 'SKILL.md'), '---\nname: a\ndescription: D2\n---\n# Body 2\n');
      await new Promise((r) => setTimeout(r, 80));
      await (source as unknown as { pollOnce: () => Promise<void> }).pollOnce();
      await source.stop();
      const upserts = events.filter((e) => e.op === 'upsert') as Array<{ skill: { description: string } }>;
      const descriptions = upserts.map((u) => u.skill.description);
      expect(descriptions).toContain('D2');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('clearing debounce timers via stop() does not throw', async () => {
    const root = await mkTempDir();
    try {
      await writeSkill(root, 'a', { name: 'a', description: 'D' }, '# Body');
      const source = new FilesystemSkillsSource(
        { skillsDir: root, watch: true, debounceMs: 1000, pollIntervalMs: 60 },
        noopLogger,
      );
      await source.start();
      // Schedule a few refreshes that will not have fired by the time we stop.
      const internal = source as unknown as { scheduleRefresh: (p: string) => void; scheduleRescan: () => void };
      internal.scheduleRefresh(path.join(root, 'a'));
      internal.scheduleRescan();
      await source.stop();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('parseSkillFrontmatter returns empty when closing --- delimiter is missing', () => {
    const { frontmatter, body } = parseSkillFrontmatter('---\nname: x\nbody-without-close');
    expect(frontmatter).toEqual({});
    expect(body).toMatch(/^---/);
  });

  it('parseSkillFrontmatter handles single-quoted values', () => {
    const { frontmatter } = parseSkillFrontmatter("---\nname: 'quoted'\n---\nbody");
    expect(frontmatter['name']).toBe('quoted');
  });
});
