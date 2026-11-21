/**
 * Runs CodeCall's validated AgentScript interpreter in workerd with nodejs_compat.
 */
import * as path from 'node:path';

import { readFile } from '@frontmcp/utils';

import { CodecallWorker } from './helpers/codecall-worker';

const coreDir = path.resolve(__dirname, '../../../../node_modules/@enclave-vm/core');

describe('CodeCall interpreter on Cloudflare Workers (workerd)', () => {
  let worker: CodecallWorker;

  beforeAll(async () => {
    worker = await CodecallWorker.start('fixture-codecall-interpreter');
  }, 170000);

  afterAll(async () => {
    await worker?.stop();
  });

  it('bundles the validated runner without the Node VM barrel', async () => {
    expect(await readFile(path.join(coreDir, 'esm', 'worker.mjs'))).toContain('AgentScriptRunner');
    expect(worker.bundle).toContain('AgentScriptRunner');
    expect(worker.bundle).not.toContain('wrapWithDoubleVm');
    expect(worker.bundle).not.toMatch(/from\s*["'](?:node:)?(?:vm|worker_threads)["']/);
  });

  it('executes an ordinary tool call inside the Worker', async () => {
    const outcome = await worker.execute("return await callTool('users.get', { id: 7 });");
    expect(outcome).toMatchObject({ status: 'ok', result: { id: 7, name: 'user-7' } });
  });

  it('exposes the CodeCall host lookup function', async () => {
    const outcome = await worker.execute("return getTool('users.get').name;");
    expect(outcome).toMatchObject({ status: 'ok', result: 'users.get' });
  });
});
