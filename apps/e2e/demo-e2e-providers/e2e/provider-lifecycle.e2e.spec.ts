/**
 * E2E: provider lifecycle hooks run in dependency order on every transport. A server-level journal and an
 * app-level factory that depends on it bootstrap before the server serves, get onReady() once it does, and
 * shut down in reverse order, on SIGTERM for HTTP and stdio and on dispose() for createDirect().
 */
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FrontMcpInstance } from '@frontmcp/sdk';
import { TestServer } from '@frontmcp/testing';
import { fileExists, randomUUID, readFile, rm } from '@frontmcp/utils';

import { serverConfig } from '../src/config';

const BOOTSTRAPPED_AND_READY = ['bootstrap:journal', 'bootstrap:probe', 'ready:journal', 'ready:probe'];
const ALL_PHASES = [...BOOTSTRAPPED_AND_READY, 'shutdown:probe', 'shutdown:journal'];

const projectPath = join(__dirname, '..');

async function readJournal(path: string): Promise<string[]> {
  return (await fileExists(path)) ? (JSON.parse(await readFile(path)) as string[]) : [];
}

async function waitForPhase(path: string, phase: string): Promise<string[]> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    // A read can land between the server truncating the journal and writing it again
    const phases = await readJournal(path).catch((error: unknown) => {
      if (error instanceof SyntaxError) return [];
      throw error;
    });
    if (phases.includes(phase)) return phases;
    if (Date.now() > deadline) throw new Error(`"${phase}" never recorded; journal: ${JSON.stringify(phases)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('Provider lifecycle E2E', () => {
  let journal: string;

  beforeEach(() => {
    journal = join(tmpdir(), `provider-lifecycle-${randomUUID()}.json`);
  });

  afterEach(async () => {
    await rm(journal, { force: true });
  });

  it('over HTTP: readies the providers once listening, and shuts them down in reverse order on SIGTERM', async () => {
    const server = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-providers/src/main.ts',
      project: 'demo-e2e-providers',
      env: { LIFECYCLE_LOG: journal },
    });
    try {
      expect(await waitForPhase(journal, 'ready:probe')).toEqual(BOOTSTRAPPED_AND_READY);
    } finally {
      await server.stop();
    }

    expect(await readJournal(journal)).toEqual(ALL_PHASES);
  });

  it('over stdio: readies the providers once connected, and shuts them down in reverse order on SIGTERM', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', join(projectPath, 'src/stdio-entrypoint.ts')], {
      cwd: projectPath,
      env: { ...process.env, LIFECYCLE_LOG: journal },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    try {
      expect(await waitForPhase(journal, 'ready:probe')).toEqual(BOOTSTRAPPED_AND_READY);
      child.kill('SIGTERM');
      expect(await exited).toBe(0);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }

    expect(await readJournal(journal)).toEqual(ALL_PHASES);
  });

  it('over createDirect(): readies the providers before it returns, and shuts them down on dispose()', async () => {
    process.env['LIFECYCLE_LOG'] = journal;
    try {
      const server = await FrontMcpInstance.createDirect(serverConfig);
      expect(await readJournal(journal)).toEqual(BOOTSTRAPPED_AND_READY);

      await server.dispose();
      expect(await readJournal(journal)).toEqual(ALL_PHASES);
    } finally {
      delete process.env['LIFECYCLE_LOG'];
    }
  });
});
