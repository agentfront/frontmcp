import * as os from 'os';
import * as path from 'path';

import { mkdtemp, readFile, rm, writeFile } from '@frontmcp/utils';

const mockExtract = jest.fn();
jest.mock('../../skills/from-entry', () => ({
  extractProjectSchema: (...args: unknown[]) => mockExtract(...args),
}));

import { emitServerManifest, SERVER_MANIFEST_FILE } from '../server-manifest';

const manifest = { manifestVersion: 1, tools: [{ name: 'add' }], skills: [] };
const finding = { rule: 'missing-description', message: 'Tool "add" has no description.' };

let project: string;
let logged: string[];

beforeEach(async () => {
  project = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-server-manifest-'));
  await writeFile(path.join(project, 'main.ts'), 'export default {};');
  mockExtract.mockReset();
  logged = [];
  jest.spyOn(console, 'log').mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
  process.exitCode = undefined;
});

afterEach(async () => {
  jest.restoreAllMocks();
  process.exitCode = undefined;
  await rm(project, { recursive: true, force: true });
});

const emit = (outDir: string, strictLint?: boolean, entry = 'main.ts') =>
  emitServerManifest({ cwd: project, entry, outDir: path.join(project, outDir), strictLint });

describe('emitServerManifest()', () => {
  it("writes the manifest into the target's output directory and warns about each lint finding", async () => {
    mockExtract.mockResolvedValue({ manifest, manifestFindings: [finding] });

    await emit('dist/node');

    expect(JSON.parse(await readFile(path.join(project, 'dist/node', SERVER_MANIFEST_FILE)))).toEqual(manifest);
    expect(await readFile(path.join(project, 'dist/node', SERVER_MANIFEST_FILE))).toMatch(/\n$/);
    expect(logged.join('\n')).toContain('manifest lint (missing-description): Tool "add" has no description.');
    expect(process.exitCode).toBeUndefined();
  });

  it('fails the build on a finding with --strict-lint', async () => {
    mockExtract.mockResolvedValue({ manifest, manifestFindings: [finding] });

    await emit('dist/node', true);

    expect(process.exitCode).toBe(1);
    expect(logged.join('\n')).toContain('1 manifest lint finding(s); --strict-lint fails the build.');
  });

  it('builds the manifest once per entry for every target of one build', async () => {
    mockExtract.mockResolvedValue({ manifest, manifestFindings: [] });
    await writeFile(path.join(project, 'once.ts'), 'export default {};');

    await emit('dist/node', false, 'once.ts');
    await emit('dist/cli', false, 'once.ts');

    expect(mockExtract).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(path.join(project, 'dist/cli', SERVER_MANIFEST_FILE)))).toEqual(manifest);
  });

  it('warns, or fails with --strict-lint, when no manifest can be built', async () => {
    await writeFile(path.join(project, 'old.ts'), 'export default {};');
    mockExtract.mockResolvedValue({ manifestError: 'the installed @frontmcp/sdk does not build manifests; upgrade it' });
    await emit('dist/node', false, 'old.ts');
    expect(logged.join('\n')).toContain(`${SERVER_MANIFEST_FILE} not written: the installed @frontmcp/sdk`);
    expect(process.exitCode).toBeUndefined();

    await writeFile(path.join(project, 'broken.ts'), 'export default {};');
    mockExtract.mockRejectedValue(new Error('esbuild failed'));
    await emit('dist/node', true, 'broken.ts');
    expect(logged.join('\n')).toContain(`${SERVER_MANIFEST_FILE} not written: esbuild failed`);
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    await emit('dist/node', false, 'missing.ts');
    expect(logged.join('\n')).toContain('Entry override not found: missing.ts');

    await writeFile(path.join(project, 'bare.ts'), 'export default {};');
    mockExtract.mockResolvedValue({});
    await emit('dist/node', false, 'bare.ts');
    expect(logged.join('\n')).toContain(`${SERVER_MANIFEST_FILE} not written: no manifest was built`);
  });
});
