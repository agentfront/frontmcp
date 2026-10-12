/**
 * `frontmcp init` against real tsconfig.json files.
 *
 * #679 — a tsconfig.json with a comment or a trailing comma (both legal for
 * TypeScript) failed `JSON.parse`, was reported as "not found" and was
 * overwritten with the default config. It is now parsed as JSONC and edited in
 * place; a file that really cannot be parsed is left untouched.
 */
import * as os from 'os';
import * as path from 'path';

import { mkdir, mkdtemp, readFile, rm, writeFile, writeJSON } from '@frontmcp/utils';

import { readTsconfig, RECOMMENDED_TSCONFIG, runInit } from '../tsconfig';

describe('runInit', () => {
  let dir: string;
  let tsconfigPath: string;
  let logSpy: jest.SpyInstance;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-init-'));
    tsconfigPath = path.join(dir, 'tsconfig.json');
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  });

  const logs = (): string[] => logSpy.mock.calls.map((call) => String(call[0]));

  it('creates tsconfig.json when it does not exist', async () => {
    await runInit(dir);

    expect(JSON.parse(await readFile(tsconfigPath))).toEqual(RECOMMENDED_TSCONFIG);
    expect(logs().some((line) => line.includes('not found'))).toBe(true);
  });

  it('updates a tsconfig.json with comments and trailing commas in place', async () => {
    await writeFile(
      tsconfigPath,
      `{
  // project settings
  "compilerOptions": {
    "strict": true, // keep strict
    "outDir": "build",
  },
  "include": ["custom/**/*"],
}
`,
    );

    await runInit(dir);

    const text = await readFile(tsconfigPath);
    expect(text).toContain('// project settings');
    expect(text).toContain('// keep strict');
    const { config } = (await readTsconfig(tsconfigPath)) ?? { config: {} };
    expect(config['compilerOptions']).toMatchObject({
      target: 'es2021',
      module: 'esnext',
      emitDecoratorMetadata: true,
      experimentalDecorators: true,
      strict: true,
      outDir: 'build',
    });
    expect(config['include']).toEqual(['custom/**/*']);
    expect(config['exclude']).toEqual(expect.arrayContaining(['**/*.widget.tsx', '**/*.widget.jsx']));
    expect(logs().some((line) => line.includes('not found'))).toBe(false);
    expect(logs().some((line) => line.includes('verified and updated'))).toBe(true);
  });

  it('leaves an already-compliant file byte-for-byte unchanged', async () => {
    await runInit(dir);
    const before = `// tuned by hand\n${await readFile(tsconfigPath)}`;
    await writeFile(tsconfigPath, before);

    await runInit(dir);

    expect(await readFile(tsconfigPath)).toBe(before);
    expect(logs().some((line) => line.includes('already present'))).toBe(true);
  });

  it('refuses to touch a tsconfig.json it cannot parse', async () => {
    const broken = '{\n  "compilerOptions": { "strict": true,, }\n}\n';
    await writeFile(tsconfigPath, broken);

    await expect(runInit(dir)).rejects.toThrow(
      /tsconfig\.json is not valid JSON: .* at line 2, column \d+\. It was left unchanged/,
    );
    expect(await readFile(tsconfigPath)).toBe(broken);
  });

  it('refuses to "enforce" a required option declared twice, where only the last one counts', async () => {
    const duplicated = '{ "compilerOptions": { "emitDecoratorMetadata": true, "emitDecoratorMetadata": false } }\n';
    await writeFile(tsconfigPath, duplicated);

    await expect(runInit(dir)).rejects.toThrow(
      /tsconfig\.json declares "compilerOptions\.emitDecoratorMetadata" more than once \(lines 1, 1\).*It was left unchanged/,
    );
    expect(await readFile(tsconfigPath)).toBe(duplicated);
  });

  it('enforces the required options when a duplicated key is one it does not edit', async () => {
    await writeFile(tsconfigPath, '{ "compilerOptions": { "strict": true, "strict": false } }\n');

    await runInit(dir);

    const { config } = (await readTsconfig(tsconfigPath)) ?? { config: {} };
    expect(config['compilerOptions']).toMatchObject({
      target: 'es2021',
      module: 'esnext',
      emitDecoratorMetadata: true,
      experimentalDecorators: true,
      strict: false,
    });
  });

  it('rewrites moduleResolution nodenext so the result has no TS5110 conflict', async () => {
    await writeFile(tsconfigPath, '{ "compilerOptions": { "module": "nodenext", "moduleResolution": "nodenext" } }');

    await runInit(dir);

    const { config } = (await readTsconfig(tsconfigPath)) ?? { config: {} };
    expect(config['compilerOptions']).toMatchObject({ module: 'esnext', moduleResolution: 'bundler' });
  });

  it('writes no types entries for packages the project has not installed', async () => {
    await runInit(dir);

    const { config } = (await readTsconfig(tsconfigPath)) ?? { config: {} };
    expect(config['compilerOptions']).not.toHaveProperty('types');
  });

  it('writes types entries for the type packages the project declares', async () => {
    await writeJSON(path.join(dir, 'package.json'), {
      devDependencies: { '@types/node': '^24.0.0', '@types/jest': '^30.0.0', '@frontmcp/testing': '1.9.6' },
    });

    await runInit(dir);

    const { config } = (await readTsconfig(tsconfigPath)) ?? { config: {} };
    expect(config['compilerOptions']['types']).toEqual(['node', 'jest', '@frontmcp/testing']);
  });

  it('drops the types list an earlier init generated when none of its packages is there', async () => {
    await writeJSON(tsconfigPath, {
      compilerOptions: { ...RECOMMENDED_TSCONFIG.compilerOptions, types: ['node', '@types/jest', '@frontmcp/testing'] },
    });

    await runInit(dir);

    const { config } = (await readTsconfig(tsconfigPath)) ?? { config: {} };
    expect(config['compilerOptions']).not.toHaveProperty('types');
  });

  it('replaces the types list an earlier init generated with the packages the project has', async () => {
    await writeJSON(path.join(dir, 'package.json'), { devDependencies: { '@types/node': '^24.0.0' } });
    await writeJSON(tsconfigPath, {
      compilerOptions: { ...RECOMMENDED_TSCONFIG.compilerOptions, types: ['node', '@types/jest', '@frontmcp/testing'] },
    });

    await runInit(dir);

    const { config } = (await readTsconfig(tsconfigPath)) ?? { config: {} };
    expect(config['compilerOptions']['types']).toEqual(['node']);
  });

  it('keeps a types list the user wrote', async () => {
    await writeJSON(tsconfigPath, {
      compilerOptions: { ...RECOMMENDED_TSCONFIG.compilerOptions, types: ['node', 'vitest/globals'] },
    });

    await runInit(dir);

    const { config } = (await readTsconfig(tsconfigPath)) ?? { config: {} };
    expect(config['compilerOptions']['types']).toEqual(['node', 'vitest/globals']);
  });

  it('writes a types entry for a type package installed but not declared', async () => {
    await mkdir(path.join(dir, 'node_modules', '@types', 'node'), { recursive: true });
    await writeJSON(path.join(dir, 'node_modules', '@types', 'node', 'package.json'), { name: '@types/node' });

    await runInit(dir);

    const { config } = (await readTsconfig(tsconfigPath)) ?? { config: {} };
    expect(config['compilerOptions']['types']).toEqual(['node']);
  });

  it.each([
    ['^6.0.0', 'bundler'],
    ['~7.0.2', 'bundler'],
    ['^5.5.3', 'node'],
  ])('picks the moduleResolution TypeScript %s accepts with frontmcp build', async (range, moduleResolution) => {
    await writeJSON(path.join(dir, 'package.json'), { devDependencies: { typescript: range } });

    await runInit(dir);

    const { config } = (await readTsconfig(tsconfigPath)) ?? { config: {} };
    expect(config['compilerOptions']['moduleResolution']).toBe(moduleResolution);
  });

  it('reads the installed TypeScript before the declared range', async () => {
    await writeJSON(path.join(dir, 'package.json'), { devDependencies: { typescript: '^5.5.3' } });
    await mkdir(path.join(dir, 'node_modules', 'typescript'), { recursive: true });
    await writeJSON(path.join(dir, 'node_modules', 'typescript', 'package.json'), {
      name: 'typescript',
      version: '6.0.3',
    });

    await runInit(dir);

    const { config } = (await readTsconfig(tsconfigPath)) ?? { config: {} };
    expect(config['compilerOptions']['moduleResolution']).toBe('bundler');
  });

  it('replaces moduleResolution bundler in an existing tsconfig.json on TypeScript 5', async () => {
    await writeJSON(path.join(dir, 'package.json'), { devDependencies: { typescript: '^5.5.3' } });
    await writeFile(tsconfigPath, '{ "compilerOptions": { "moduleResolution": "bundler" } }');

    await runInit(dir);

    const { config } = (await readTsconfig(tsconfigPath)) ?? { config: {} };
    expect(config['compilerOptions']['moduleResolution']).toBe('node');
  });

  describe('a project inside a folder that has its own TypeScript installed', () => {
    let projectDir: string;

    beforeEach(async () => {
      await mkdir(path.join(dir, 'node_modules', 'typescript'), { recursive: true });
      await writeJSON(path.join(dir, 'node_modules', 'typescript', 'package.json'), {
        name: 'typescript',
        version: '5.9.3',
      });
      projectDir = path.join(dir, 'app');
      await mkdir(projectDir, { recursive: true });
    });

    const moduleResolutionAfterInit = async () => {
      await runInit(projectDir);
      const { config } = (await readTsconfig(path.join(projectDir, 'tsconfig.json'))) ?? { config: {} };
      return config['compilerOptions']['moduleResolution'];
    };

    it("follows the project's declared TypeScript over the ancestor's", async () => {
      await writeJSON(path.join(projectDir, 'package.json'), { devDependencies: { typescript: '^6.0.0' } });

      expect(await moduleResolutionAfterInit()).toBe('bundler');
    });

    it("uses the ancestor's TypeScript, which the build will run, when the project declares none", async () => {
      await writeJSON(path.join(projectDir, 'package.json'), { name: 'app' });

      expect(await moduleResolutionAfterInit()).toBe('node');
    });
  });

  it('replaces moduleResolution node in an existing tsconfig.json on TypeScript 6', async () => {
    await writeJSON(path.join(dir, 'package.json'), { devDependencies: { typescript: '^6.0.0' } });
    await writeFile(tsconfigPath, '{ "compilerOptions": { "moduleResolution": "node" } }');

    await runInit(dir);

    const { config } = (await readTsconfig(tsconfigPath)) ?? { config: {} };
    expect(config['compilerOptions']['moduleResolution']).toBe('bundler');
  });

  it('appends the widget excludes to an existing exclude list (#445)', async () => {
    await writeFile(tsconfigPath, '{ "compilerOptions": { "strict": true }, "exclude": ["node_modules"] }');

    await runInit(dir);

    const { config } = (await readTsconfig(tsconfigPath)) ?? { config: {} };
    expect(config['exclude']).toEqual(['node_modules', '**/*.widget.tsx', '**/*.widget.jsx']);
    expect(logs().some((line) => /Added widget-file excludes.*issue #445/.test(line))).toBe(true);
  });

  it('uses process.cwd() when no directory is given', async () => {
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(dir);
    try {
      await runInit();
    } finally {
      cwd.mockRestore();
    }
    expect(JSON.parse(await readFile(tsconfigPath))).toEqual(RECOMMENDED_TSCONFIG);
  });
});

describe('readTsconfig', () => {
  it('returns undefined for a missing file', async () => {
    await expect(
      readTsconfig(path.join(os.tmpdir(), 'frontmcp-no-such-dir', 'tsconfig.json')),
    ).resolves.toBeUndefined();
  });
});
