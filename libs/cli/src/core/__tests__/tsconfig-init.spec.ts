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

import { mkdtemp, readFile, rm, writeFile } from '@frontmcp/utils';

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
    expect(config['compilerOptions']).toMatchObject({ module: 'esnext', moduleResolution: 'node' });
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
