import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../exec/index', () => ({ buildExec: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../sdk/index', () => ({ buildSdk: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../../shared/clean-out-dir', () => ({ cleanOutDir: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../server-manifest', () => ({ emitServerManifest: jest.fn().mockResolvedValue(undefined) }));

import { runBuild } from '../index';
import { emitServerManifest } from '../server-manifest';

const mockEmit = emitServerManifest as jest.Mock;

describe('frontmcp build writes the server manifest for each target', () => {
  let tmp: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-build-manifest-')));
    process.chdir(tmp);
  });
  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it("emits it into every target's output directory, from the configured entry", async () => {
    fs.writeFileSync(
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
