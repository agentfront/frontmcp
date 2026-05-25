import { installSkill } from '../install';

/**
 * Unit tests for `frontmcp skills install --from-entry/--from-package`.
 *
 * The bundle+extract pipeline (`extractProjectSkills`) is mocked: it lives
 * in its own module and is exercised end-to-end by the e2e suite. Here we
 * verify the install command's filtering, frontmatter composition, target
 * paths, and CLAUDE.md update behaviour against the resolved skill assets.
 */

let mockFiles: Record<string, string> = {};
let mockDirs: Set<string> = new Set();
const writtenFiles: Record<string, string> = {};

jest.mock('../../../core/version', () => ({
  getSelfVersion: () => '1.0.0-test',
}));

jest.mock('../catalog', () => ({
  loadCatalog: () => ({ version: 1, skills: [] }),
  getCatalogDir: () => '/mock/catalog',
}));

jest.mock('@frontmcp/utils', () => ({
  fileExists: jest.fn(async (p: string) => p in mockFiles || mockDirs.has(p)),
  readFile: jest.fn(async (p: string) => mockFiles[p] ?? ''),
  writeFile: jest.fn(async (p: string, content: string) => {
    writtenFiles[p] = content;
    mockFiles[p] = content;
  }),
  ensureDir: jest.fn(async (p: string) => {
    // Real ensureDir creates parents recursively — mirror that so the
    // CLAUDE.md scan can find the `.claude/skills` parent after each install.
    let cursor = p;
    while (cursor && cursor !== '/' && !mockDirs.has(cursor)) {
      mockDirs.add(cursor);
      const idx = cursor.lastIndexOf('/');
      if (idx <= 0) break;
      cursor = cursor.slice(0, idx);
    }
  }),
  cp: jest.fn(async (src: string, dest: string) => {
    writtenFiles[`${dest}/<copy>`] = src;
    mockDirs.add(dest);
  }),
  readdir: jest.fn(async (dir: string) => {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    const children = new Set<string>();
    for (const file of Object.keys(mockFiles)) {
      if (file.startsWith(prefix)) {
        const rest = file.slice(prefix.length);
        const seg = rest.split('/')[0];
        if (seg) children.add(seg);
      }
    }
    return Array.from(children).sort();
  }),
}));

// Don't actually spawn esbuild or boot the SDK — return canned skill assets.
const mockExtract = jest.fn();
jest.mock('../from-entry', () => ({
  extractProjectSkills: (...args: unknown[]) => mockExtract(...args),
  resolvePackageEntry: jest.fn((pkg: string) => `/mock/node_modules/${pkg}/dist/main.cjs`),
}));

// Avoid hitting the real package.json lookup chain in resolveEntry.
jest.mock('../../../shared/fs', () => ({
  resolveEntry: jest.fn(async (cwd: string, explicit?: string) =>
    explicit ? `${cwd}/${explicit}` : `${cwd}/src/main.ts`,
  ),
}));

let exitSpy: jest.SpyInstance;
const originalCwd = process.cwd();

beforeEach(() => {
  mockFiles = {};
  mockDirs = new Set();
  for (const k of Object.keys(writtenFiles)) delete writtenFiles[k];
  mockExtract.mockReset();
  jest.spyOn(process, 'cwd').mockReturnValue('/test/project');
  // Suppress process.exit so we can assert on the surrounding behaviour
  exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  Object.defineProperty(process, 'cwd', { value: () => originalCwd });
});

describe('installSkill --from-entry / --from-package', () => {
  it('rejects passing both --from-entry and --from-package together', async () => {
    await expect(
      installSkill(undefined, {
        provider: 'claude',
        fromEntry: 'src/main.ts',
        fromPackage: 'example-server',
        all: true,
      }),
    ).rejects.toThrow(/process\.exit\(1\)/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects --from-entry without a selector (no name and no --all)', async () => {
    mockExtract.mockResolvedValue([{ skillName: 'one', description: 'first', instructionFile: '/proj/skill-one.md' }]);
    await expect(installSkill(undefined, { provider: 'claude', fromEntry: 'src/main.ts' })).rejects.toThrow(
      /process\.exit\(1\)/,
    );
  });

  it('installs all @Skill entries when --all is supplied, composing frontmatter from decorator metadata', async () => {
    mockFiles['/proj/skill-one.md'] = '# One body without frontmatter';
    mockFiles['/proj/skill-two.md'] = ['---', 'name: two', 'description: pre-existing', '---', '', 'body'].join('\n');
    mockExtract.mockResolvedValue([
      {
        skillName: 'skill-one',
        description: 'First skill description',
        tags: ['alpha'],
        license: 'MIT',
        instructionFile: '/proj/skill-one.md',
      },
      {
        skillName: 'skill-two',
        description: 'Second skill description',
        instructionFile: '/proj/skill-two.md',
      },
    ]);

    await installSkill(undefined, { provider: 'claude', fromEntry: 'src/main.ts', all: true });

    // skill-one: body had no frontmatter, so the composer should have prepended one
    const one = writtenFiles['/test/project/.claude/skills/skill-one/SKILL.md'];
    expect(one).toBeDefined();
    expect(one).toContain('name: skill-one');
    expect(one).toContain('description: First skill description');
    expect(one).toContain('tags: [alpha]');
    expect(one).toContain('license: MIT');
    expect(one).toContain('# One body without frontmatter');

    // skill-two: body already had frontmatter — preserved verbatim
    const two = writtenFiles['/test/project/.claude/skills/skill-two/SKILL.md'];
    expect(two).toBe(mockFiles['/proj/skill-two.md']);
  });

  it('installs a single named skill and copies its resource directories', async () => {
    mockFiles['/proj/instructions.md'] = '# Body';
    mockDirs.add('/proj/refs');
    mockDirs.add('/proj/examples');
    mockExtract.mockResolvedValue([
      {
        skillName: 'wanted',
        description: 'the one we want',
        instructionFile: '/proj/instructions.md',
        resourceDirs: { references: '/proj/refs', examples: '/proj/examples' },
      },
      {
        skillName: 'unwanted',
        description: 'the other one',
        instructionFile: '/proj/instructions.md',
      },
    ]);

    await installSkill('wanted', { provider: 'claude', fromEntry: 'src/main.ts' });

    expect(writtenFiles['/test/project/.claude/skills/wanted/SKILL.md']).toBeDefined();
    expect(writtenFiles['/test/project/.claude/skills/unwanted/SKILL.md']).toBeUndefined();
    expect(writtenFiles['/test/project/.claude/skills/wanted/references/<copy>']).toBe('/proj/refs');
    expect(writtenFiles['/test/project/.claude/skills/wanted/examples/<copy>']).toBe('/proj/examples');
  });

  it('errors when the named skill is not exposed by the entry', async () => {
    mockExtract.mockResolvedValue([
      { skillName: 'a', description: 'a' },
      { skillName: 'b', description: 'b' },
    ]);

    await expect(installSkill('does-not-exist', { provider: 'claude', fromEntry: 'src/main.ts' })).rejects.toThrow(
      /process\.exit\(1\)/,
    );
  });

  it('errors when the project exposes no @Skill entries at all', async () => {
    mockExtract.mockResolvedValue([]);

    await expect(installSkill(undefined, { provider: 'claude', fromEntry: 'src/main.ts', all: true })).rejects.toThrow(
      /process\.exit\(1\)/,
    );
  });

  it('rejects malicious skill names (path traversal) and skips them without writing anything', async () => {
    mockFiles['/proj/body.md'] = 'body';
    mockExtract.mockResolvedValue([
      { skillName: '../../escape', description: 'tries to escape', instructionFile: '/proj/body.md' },
      { skillName: 'safe', description: 'fine', instructionFile: '/proj/body.md' },
    ]);

    await installSkill(undefined, { provider: 'claude', fromEntry: 'src/main.ts', all: true });

    // The malicious entry must NOT have been written anywhere — the loop
    // calls `assertValidPluginName` and skips it. The safe entry still installs.
    const writtenPaths = Object.keys(writtenFiles);
    expect(writtenPaths.some((p) => p.includes('escape'))).toBe(false);
    expect(writtenFiles['/test/project/.claude/skills/safe/SKILL.md']).toBeDefined();
  });

  it('routes --from-package through resolvePackageEntry instead of the local resolveEntry', async () => {
    mockFiles['/mock/skill.md'] = 'body';
    mockExtract.mockResolvedValue([
      { skillName: 'from-pkg', description: 'shipped by a package', instructionFile: '/mock/skill.md' },
    ]);

    await installSkill('from-pkg', { provider: 'claude', fromPackage: 'example-server' });

    const written = writtenFiles['/test/project/.claude/skills/from-pkg/SKILL.md'];
    expect(written).toBeDefined();
    expect(written).toContain('name: from-pkg');
  });

  it('updates CLAUDE.md after installing a project-defined skill', async () => {
    mockFiles['/proj/body.md'] = '# Body';
    mockExtract.mockResolvedValue([
      { skillName: 'example-project', description: 'project conventions', instructionFile: '/proj/body.md' },
    ]);

    await installSkill('example-project', { provider: 'claude', fromEntry: 'src/main.ts' });

    const claudeMd = writtenFiles['/test/project/CLAUDE.md'];
    expect(claudeMd).toBeDefined();
    expect(claudeMd).toContain('**example-project**');
    expect(claudeMd).toContain('project conventions');
  });
});
