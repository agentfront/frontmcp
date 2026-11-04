/**
 * E2E: a CLI built for a server whose skills a plugin registers at runtime (a Skilled OpenAPI bundle). A one-shot
 * command sees those skills, `skills read` / `skills load` exit 1 for a skill they do not find, `run-workflow` and
 * `execute-action` exit 1 for a call that fails, and a running daemon serves the commands from the bundle it loaded once.
 */
import { createServer } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import { mkdtemp, rename, rm } from '@frontmcp/utils';

import { removeScratchProject } from './helpers/dev-cli';
import { runCliBundle, runCliBundleAsync, type CliResult } from './helpers/exec-cli';
import { buildSkilledCliProject, type SkilledCliProject } from './helpers/skilled-cli-project';

const APP_NAME = 'skilled-cli-demo';
const INVOICE = { id: 'inv_1', status: 'paid' };

describe('a CLI whose skills a plugin registers at runtime', () => {
  let project: SkilledCliProject;
  let homeDir: string;
  const apiRequests: string[] = [];
  const invoiceApi = createServer((req, res) => {
    apiRequests.push(req.url ?? '');
    const found = req.url === '/v1/invoices/inv_1';
    res.writeHead(found ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(found ? INVOICE : { error: 'invoice not found' }));
  });

  function run(args: string[]): CliResult {
    return runCliBundle(project.cliBundle, args, { FRONTMCP_HOME: homeDir });
  }

  // The command calls the API this process serves, so it must not block this process
  function runReachingTheApi(args: string[]): Promise<CliResult> {
    return runCliBundleAsync(project.cliBundle, args, { FRONTMCP_HOME: homeDir });
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => invoiceApi.listen(0, '127.0.0.1', resolve));
    const address = invoiceApi.address();
    if (!address || typeof address === 'string') throw new Error('the invoice API has no port');
    project = await buildSkilledCliProject({
      prefix: 'skilled-cli',
      appName: APP_NAME,
      serviceBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    });
    // Short: the daemon's socket path must fit the platform's limit
    homeDir = await mkdtemp(path.join(os.tmpdir(), 'fmcp-sk-'));
  }, 180_000);

  afterAll(async () => {
    run(['daemon', 'stop']);
    await new Promise((resolve) => invoiceApi.close(resolve));
    await rm(homeDir, { recursive: true, force: true });
    await removeScratchProject(project.dir);
  });

  beforeEach(() => {
    apiRequests.length = 0;
  });

  it('lists the bundle skills', () => {
    const { stdout, exitCode } = run(['skills', 'list']);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Invoices');
  });

  it('searches the bundle skills', () => {
    const { stdout, exitCode } = run(['skills', 'search', 'invoices']);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Invoices');
  });

  it("reads a bundle skill's SKILL.md resource", () => {
    const { stdout, exitCode } = run(['resource', 'read', 'skill://Invoices/SKILL.md']);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('name: Invoices');
    expect(stdout).toContain('Find an invoice by its id.');
  });

  it('loads a bundle skill', () => {
    const { stdout, exitCode } = run(['skills', 'load', 'invoices']);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Loaded 1 of 1 skill(s).');
  });

  it('exits 1 from skills load when a skill is not found, and names it', () => {
    const { stdout, stderr, exitCode } = run(['skills', 'load', 'invoices', 'refunds']);

    expect(exitCode).toBe(1);
    expect(stdout).toContain('Loaded 1 of 2 skill(s).');
    expect(stderr).toContain('Skill "refunds" not found');
  });

  it('exits 1 from skills read when the skill is not found', () => {
    const { stdout, stderr, exitCode } = run(['skills', 'read', 'refunds']);

    expect(exitCode).toBe(1);
    expect(stdout).not.toContain('Loaded');
    expect(stderr).toContain('Skill "refunds" not found.');
  });

  it('exits 1 from skills read --output json when the skill is not found', () => {
    const { stdout, exitCode } = run(['--output', 'json', 'skills', 'read', 'refunds']);

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({ skills: [] });
  });

  it('exits 0 from run-workflow for a workflow that succeeds', () => {
    const { stdout, exitCode } = run(['--output', 'json', 'run-workflow', '--script', 'return 1 + 1;']);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ structuredContent: { success: true, value: 2 } });
  });

  it('exits 1 from run-workflow for a workflow that fails, with its error', () => {
    const { stdout, exitCode } = run([
      '--output',
      'json',
      'run-workflow',
      '--script',
      "return await callTool('refundInvoice', { id: 'inv_1' });",
    ]);

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({
      isError: true,
      structuredContent: { success: false, error: expect.stringContaining('unknown action "refundInvoice"') },
    });
  });

  it('runs one action with execute-action and exits 0, with its data', async () => {
    const { stdout, exitCode } = await runReachingTheApi([
      '--output',
      'json',
      'execute-action',
      '--action-id',
      'getInvoice',
      '--input',
      '{"id":"inv_1"}',
    ]);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ structuredContent: INVOICE });
    expect(apiRequests).toEqual(['/v1/invoices/inv_1']);
  });

  it("exits 1 from execute-action for an action that fails, with the API's error body", async () => {
    const { stdout, exitCode } = await runReachingTheApi([
      '--output',
      'json',
      'execute-action',
      '--action-id',
      'getInvoice',
      '--input',
      '{"id":"inv_missing"}',
    ]);

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({
      isError: true,
      structuredContent: { ok: false, status: 404, data: { error: 'invoice not found' } },
    });
  });

  it('exits 1 from execute-action for an unknown action, sending nothing', async () => {
    const { stdout, exitCode } = await runReachingTheApi([
      '--output',
      'json',
      'execute-action',
      '--action-id',
      'refundInvoice',
    ]);

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({
      isError: true,
      structuredContent: { ok: false, status: 0, error: expect.stringContaining('unknown action "refundInvoice"') },
    });
    expect(apiRequests).toEqual([]);
  });

  describe('with its daemon running', () => {
    const movedBundlePath = () => `${project.bundlePath}.moved`;

    beforeAll(() => {
      expect(run(['daemon', 'start'])).toMatchObject({ exitCode: 0 });
    });

    afterAll(async () => {
      run(['daemon', 'stop']);
      await rename(movedBundlePath(), project.bundlePath).catch(() => undefined);
    });

    it('serves the commands from the bundle it loaded, after the file is gone', async () => {
      expect(run(['skills', 'list']).stdout).toContain('Invoices');
      // An in-process command reads the bundle file at start; only the daemon still has the bundle
      await rename(project.bundlePath, movedBundlePath());

      expect(run(['skills', 'list'])).toMatchObject({ exitCode: 0, stdout: expect.stringContaining('Invoices') });
      expect(run(['resource', 'read', 'skill://Invoices/SKILL.md']).stdout).toContain('name: Invoices');
      expect(run(['search-skill', '--query', 'invoices']).stdout).toContain('invoices');
    });

    it('leaves a command without the daemon to read the bundle itself', () => {
      expect(run(['daemon', 'stop'])).toMatchObject({ exitCode: 0 });

      expect(run(['skills', 'list']).stdout).not.toContain('Invoices');
    });
  });
});
