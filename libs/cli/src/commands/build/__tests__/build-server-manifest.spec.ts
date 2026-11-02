import * as os from 'os';
import * as path from 'path';

import { mkdtemp, realpath, rm, writeFile } from '@frontmcp/utils';

import { runBuild } from '../index';
import { emitServerManifest } from '../server-manifest';

jest.mock('../exec/index', () => ({ buildExec: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../sdk/index', () => ({ buildSdk: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../../shared/clean-out-dir', () => ({ cleanOutDir: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../server-manifest', () => ({ emitServerManifest: jest.fn().mockResolvedValue(undefined) }));

const mockEmit = emitServerManifest as jest.Mock;

describe('frontmcp build writes the server manifest for each target', () => {
  let tmp: string;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'frontmcp-build-manifest-')));
    process.chdir(tmp);
  });
  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tmp, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it("emits it into every target's output directory, from the configured entry", async () => {
    await writeFile(
      path.join(tmp, 'frontmcp.config.json'),
      JSON.stringify({ name: 'demo', entry: './src/main.ts', deployments: [{ target: 'node' }, { target: 'sdk' }] }),
    );

    await runBuild({ _: [], strictLint: true });

    expect(mockEmit.mock.calls.map(([options]) => options)).toEqual([
      { cwd: tmp, entry: './src/main.ts', outDir: path.join(tmp, 'dist', 'node'), strictLint: true },
      { cwd: tmp, entry: './src/main.ts', outDir: path.join(tmp, 'dist', 'sdk'), strictLint: true },
    ]);
  });

  it('skips it with --no-manifest', async () => {
    await runBuild({ _: [], buildTarget: 'node', manifest: false });

    expect(mockEmit).not.toHaveBeenCalled();
  });
});
