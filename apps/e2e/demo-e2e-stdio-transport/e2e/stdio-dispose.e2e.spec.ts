/**
 * E2E: SIGTERM on a stdio server disposes its scope, so `onDispose` callbacks run before it exits.
 * They never ran under stdio: the handler shut the scope down and exited without disposing it.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { StdioJsonRpcProcess } from './helpers/stdio-json-rpc';

const projectPath = path.join(__dirname, '..');

describe('stdio shutdown', () => {
  let directory: string;
  let server: StdioJsonRpcProcess | undefined;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stdio-dispose-'));
  });

  afterEach(async () => {
    await server?.stop();
    server = undefined;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('runs onDispose callbacks on SIGTERM, then exits 0', async () => {
    const marker = path.join(directory, 'disposed');
    server = StdioJsonRpcProcess.start('src/stdio-dispose-entrypoint.ts', projectPath, { DISPOSE_MARKER: marker });
    const initialized = await server.request({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dispose-e2e', version: '1.0' } },
    });
    expect(initialized.result).toBeDefined();

    const exitCode = await server.terminate();

    expect(exitCode).toBe(0);
    expect(fs.readFileSync(marker, 'utf8')).toBe('disposed');
  }, 60_000);
});
