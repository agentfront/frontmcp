/**
 * E2E: a script reads a provider with createContainer() and never serves MCP. The app's provider is
 * bootstrapped when the script reads it, shut down by dispose(), and the process exits on its own.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const projectPath = join(__dirname, '..');
const script = join(projectPath, 'src/container-script.ts');

function runScript(): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script], {
      cwd: projectPath,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('createContainer() in a script', () => {
  it('reads a bootstrapped app provider, shuts it down on dispose(), and exits without serving', async () => {
    const { code, stdout, stderr } = await runScript();

    expect({ code, stderr }).toMatchObject({ code: 0 });
    expect(JSON.parse(stdout.trim())).toEqual({ whileOpen: 'open', afterDispose: 'closed' });
  }, 60_000);
});
