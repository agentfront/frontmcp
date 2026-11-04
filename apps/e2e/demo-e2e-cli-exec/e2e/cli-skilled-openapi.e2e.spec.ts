/**
 * E2E: a CLI built for a server that serves a Skilled OpenAPI bundle. On a server whose only tools are the plugin's,
 * `search_skill`, `load_skill`, `execute` and `run_workflow` are top-level commands, and the same commands live under
 * `skills`; on a server with tools of its own, only under `skills`. A destructive action asks for confirmation, which
 * `--yes` gives and a command with no terminal declines, in-process and through the daemon.
 */
import { createServer } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import { mkdtemp, rename, rm, writeFile } from '@frontmcp/utils';

import { removeScratchProject } from './helpers/dev-cli';
import { runCliBundle, runCliBundleAsync, type CliResult } from './helpers/exec-cli';
import { buildSkilledCliProject, type SkilledCliProject } from './helpers/skilled-cli-project';

const APP_NAME = 'skilled-cli-demo';
const INVOICE = { id: 'inv_1', status: 'paid' };
const CONFIRM_DECLINED = 'Declined: there is no terminal to ask on. Run the command again with --yes to confirm.';

describe("a CLI for a server whose only tools are the Skilled OpenAPI plugin's", () => {
  let project: SkilledCliProject;
  let homeDir: string;
  const apiRequests: string[] = [];
  const invoiceApi = createServer((req, res) => {
    apiRequests.push(`${req.method} ${req.url}`);
    const found = req.url === '/v1/invoices/inv_1';
    res.writeHead(found ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(found ? INVOICE : { error: 'invoice not found' }));
  });

  function run(args: string[]): CliResult {
    return runCliBundle(project.cliBundle, args, { FRONTMCP_HOME: homeDir });
  }

  // The command calls the API this process serves, so it must not block this process
  function runReachingTheApi(args: string[], stdin?: string): Promise<CliResult> {
    return runCliBundleAsync(project.cliBundle, args, { FRONTMCP_HOME: homeDir }, stdin);
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => invoiceApi.listen(0, '127.0.0.1', resolve));
    const address = invoiceApi.address();
    if (!address || typeof address === 'string') throw new Error('the invoice API has no port');
    project = await buildSkilledCliProject({
      prefix: 'skilled-cli',
      appName: APP_NAME,
      serviceBaseUrl: `http://127.0.0.1:${address.port}/v1`,
      serverConfig: "auth: { mode: 'public' },\n  elicitation: { enabled: true },",
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

  describe('help', () => {
    it('lists the skill commands at the top level, and no tool commands', () => {
      const { stdout, exitCode } = run(['--help']);

      expect(exitCode).toBe(0);
      const skillsSection = stdout.slice(stdout.indexOf('Skills:'));
      expect(skillsSection).toMatch(/search_skill\|search-skill \[options\] \[query\.\.\.\]\s+Find the skills/);
      expect(skillsSection).toMatch(/load_skill\|load-skill \[options\] \[skills\.\.\.\]\s+Show skills' instructions/);
      expect(skillsSection).toMatch(/execute\|execute_action \[options\] <actionId>\s+Run one action/);
      expect(skillsSection).toMatch(/run_workflow\|run-workflow \[options\] \[script\]\s+Run a workflow script/);
      expect(skillsSection).toMatch(/skills\s+Find, load and run skills/);
      expect(stdout).not.toContain('Tools:');
      expect(stdout).not.toContain('--query');
      expect(stdout).toContain('--yes');
    });

    it('lists the skills group commands, and how to see the skills', () => {
      const { stdout, exitCode } = run(['skills', '--help']);

      expect(exitCode).toBe(0);
      for (const command of [
        'search [options] [query...]',
        'load <skills...>',
        'execute [options] <actionId>',
        'run [options] [script]',
        'read <skill>',
        'list',
      ]) {
        expect(stdout).toContain(command);
      }
      expect(stdout).toContain(`The skills you can use: ${APP_NAME} skills list`);
    });
  });

  describe('search', () => {
    it('lists the matching skills with their scores, and how to load one', () => {
      const { stdout, exitCode } = run(['search_skill', 'look up an invoice']);

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/Invoices \(invoices\) {2}score \d\.\d\d\n {2}Look up invoices\./);
      expect(stdout).toContain(`Load one: ${APP_NAME} load_skill <skillId>`);
    });

    it("prints the tool's structured content with --output json", () => {
      const { stdout, exitCode } = run(['--output', 'json', 'search-skill', 'invoices', '--limit', '1']);

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toEqual({
        skills: [expect.objectContaining({ skillId: 'invoices', name: 'Invoices', bundleVersion: '1.0.0' })],
      });
    });

    it('serves skills search and the 1.11.0 search-skill --query alike', () => {
      expect(run(['skills', 'search', 'invoices']).stdout).toContain('Invoices (invoices)');
      expect(run(['search-skill', '--query', 'invoices']).stdout).toContain('Invoices (invoices)');
    });

    it('exits 2 without a query', () => {
      expect(run(['search_skill'])).toMatchObject({
        exitCode: 2,
        stderr: expect.stringContaining('say what you want to do'),
      });
    });
  });

  describe('load', () => {
    it('prints the instructions, then each action with a ready execute command', () => {
      const { stdout, exitCode } = run(['load_skill', 'invoices']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Invoices (invoices)\nLook up invoices.\n\n# Invoices\n\nFind an invoice by its id.');
      expect(stdout).toContain('Actions (2):');
      expect(stdout).toContain(
        `  getInvoice: Get an invoice by id.\n    ${APP_NAME} execute getInvoice --input '{"id":"<id>"}'`,
      );
      expect(stdout).toContain(
        `  voidInvoice: Void an invoice.\n    ${APP_NAME} execute voidInvoice --input '{"id":"<id>"}'`,
      );
    });

    it('gives the actions with their schemas with --output json', () => {
      const { stdout } = run(['--output', 'json', 'load_skill', 'invoices']);

      expect(JSON.parse(stdout)).toMatchObject({
        skill: {
          id: 'invoices',
          actions: [{ actionId: 'getInvoice', inputJsonSchema: { required: ['id'] } }, { actionId: 'voidInvoice' }],
        },
      });
    });

    it('exits 1 when a skill is not found, and names it', () => {
      const { stderr, exitCode } = run(['load_skill', 'invoices', 'refunds']);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('Skill "refunds" not found');
    });

    it("reads a skill's SKILL.md with skills read, and exits 1 for one it does not find", () => {
      expect(run(['skills', 'read', 'Invoices'])).toMatchObject({
        exitCode: 0,
        stdout: expect.stringContaining('name: Invoices'),
      });
      expect(run(['skills', 'read', 'refunds'])).toMatchObject({ exitCode: 1 });
    });

    it('lists the skills the caller can use', () => {
      const { stdout, exitCode } = run(['skills', 'list']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Invoices\n  Look up invoices.');
      expect(stdout).not.toContain('Admin');
    });
  });

  describe('execute', () => {
    it('runs one action and prints its data', async () => {
      const { stdout, exitCode } = await runReachingTheApi(['execute', 'getInvoice', '--input', '{"id":"inv_1"}']);

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toEqual(INVOICE);
      expect(apiRequests).toEqual(['GET /v1/invoices/inv_1']);
    });

    it('reads the input from a file with --input-file, and from standard input with --input -', async () => {
      const inputFile = path.join(project.dir, 'input.json');
      await writeFile(inputFile, '{"id":"inv_1"}');

      const fromFile = await runReachingTheApi([
        '--output',
        'json',
        'execute',
        'getInvoice',
        '--input-file',
        inputFile,
      ]);
      const fromStdin = await runReachingTheApi(
        ['--output', 'json', 'execute', 'getInvoice', '--input', '-'],
        '{"id":"inv_1"}',
      );

      expect(JSON.parse(fromFile.stdout)).toEqual(INVOICE);
      expect(JSON.parse(fromStdin.stdout)).toEqual(INVOICE);
      expect(apiRequests).toEqual(['GET /v1/invoices/inv_1', 'GET /v1/invoices/inv_1']);
    });

    it("exits 1 for an action that fails, with the API's error body", async () => {
      const { stdout, stderr, exitCode } = await runReachingTheApi([
        '--output',
        'json',
        'execute',
        'getInvoice',
        '--input',
        '{"id":"inv_missing"}',
      ]);

      expect(exitCode).toBe(1);
      expect(JSON.parse(stdout)).toEqual({ ok: false, status: 404, data: { error: 'invoice not found' } });
      expect(stderr).toContain('Error: action "getInvoice" failed with status 404: {"error":"invoice not found"}');
    });

    it('exits 1 for an unknown action, sending nothing', async () => {
      const { stderr, exitCode } = await runReachingTheApi(['execute', 'refundInvoice']);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('unknown action "refundInvoice"');
      expect(apiRequests).toEqual([]);
    });

    it('exits 2 for input that is not JSON', async () => {
      expect(await runReachingTheApi(['execute', 'getInvoice', '--input', '{"id"'])).toMatchObject({ exitCode: 2 });
    });
  });

  describe('run_workflow', () => {
    const script = "const invoice = await callTool('getInvoice', { id: 'inv_1' });\nreturn invoice.status;";

    it('runs a script given as an argument, and prints its value', async () => {
      const { stdout, exitCode } = await runReachingTheApi(['run_workflow', script]);

      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('paid');
    });

    it('reads the script from --file and from standard input', async () => {
      const scriptFile = path.join(project.dir, 'status.js');
      await writeFile(scriptFile, script);

      const fromFile = await runReachingTheApi(['--output', 'json', 'run_workflow', '--file', scriptFile]);
      const fromStdin = await runReachingTheApi(['--output', 'json', 'run-workflow', '-'], script);

      expect(JSON.parse(fromFile.stdout)).toMatchObject({ success: true, value: 'paid' });
      expect(JSON.parse(fromStdin.stdout)).toMatchObject({ success: true, value: 'paid' });
    });

    it('takes the 1.11.0 run-workflow --script', () => {
      expect(run(['run-workflow', '--script', 'return 1 + 1;'])).toMatchObject({ exitCode: 0, stdout: '2\n' });
    });

    it('exits 1 for a workflow that fails, with its error', () => {
      const { stdout, stderr, exitCode } = run([
        '--output',
        'json',
        'run_workflow',
        "return await callTool('refundInvoice', { id: 'inv_1' });",
      ]);

      expect(exitCode).toBe(1);
      expect(JSON.parse(stdout)).toMatchObject({
        success: false,
        error: expect.stringContaining('unknown action "refundInvoice"'),
      });
      expect(stderr).toContain('Error: unknown action "refundInvoice"');
    });
  });

  describe('confirming a destructive action', () => {
    const voidInvoice = ['execute', 'voidInvoice', '--input', '{"id":"inv_1"}'];

    it('declines it when there is no terminal to ask on, sending nothing', async () => {
      const { stderr, exitCode } = await runReachingTheApi(voidInvoice);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('Run voidInvoice: Void an invoice. (DELETE /invoices/{id}) with {"id":"inv_1"}?');
      expect(stderr).toContain(CONFIRM_DECLINED);
      expect(stderr).toContain('Error: the user declined: voidInvoice');
      expect(apiRequests).toEqual([]);
    });

    it('runs it with --yes, before or after the command', async () => {
      const after = await runReachingTheApi([...voidInvoice, '--yes']);
      const before = await runReachingTheApi(['--yes', ...voidInvoice]);

      expect([after.exitCode, before.exitCode]).toEqual([0, 0]);
      expect(apiRequests).toEqual(['DELETE /v1/invoices/inv_1', 'DELETE /v1/invoices/inv_1']);
    });

    it('asks once for a workflow that names it, which --yes confirms', async () => {
      const voidScript = "await callTool('voidInvoice', { id: 'inv_1' });\nreturn 'voided';";

      const declined = await runReachingTheApi(['run_workflow', voidScript]);
      const confirmed = await runReachingTheApi(['--yes', 'run_workflow', voidScript]);

      expect(declined).toMatchObject({ exitCode: 1, stderr: expect.stringContaining(CONFIRM_DECLINED) });
      expect(confirmed).toMatchObject({ exitCode: 0, stdout: 'voided\n' });
      expect(apiRequests).toEqual(['DELETE /v1/invoices/inv_1']);
    });
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

    it("asks the daemon's confirmation question in the CLI: declined without a terminal, given by --yes", async () => {
      const voidInvoice = ['execute', 'voidInvoice', '--input', '{"id":"inv_1"}'];

      const declined = await runReachingTheApi(voidInvoice);
      const confirmed = await runReachingTheApi(['--yes', ...voidInvoice]);

      expect(declined).toMatchObject({ exitCode: 1, stderr: expect.stringContaining(CONFIRM_DECLINED) });
      expect(confirmed.exitCode).toBe(0);
      expect(`${declined.stderr}${confirmed.stderr}`).not.toContain('running the command in-process');
      expect(apiRequests).toEqual(['DELETE /v1/invoices/inv_1']);
    });

    it('serves the commands from the bundle it loaded, after the file is gone', async () => {
      expect(run(['skills', 'list']).stdout).toContain('Invoices');
      // An in-process command reads the bundle file at start; only the daemon still has the bundle
      await rename(project.bundlePath, movedBundlePath());

      expect(run(['skills', 'list'])).toMatchObject({ exitCode: 0, stdout: expect.stringContaining('Invoices') });
      expect(run(['skills', 'read', 'Invoices']).stdout).toContain('name: Invoices');
      expect(run(['search_skill', 'invoices']).stdout).toContain('Invoices (invoices)');
      expect(run(['load_skill', 'invoices']).stdout).toContain(`${APP_NAME} execute getInvoice`);
    });

    it('leaves a command without the daemon to read the bundle itself', () => {
      expect(run(['daemon', 'stop'])).toMatchObject({ exitCode: 0 });

      expect(run(['skills', 'list']).stdout).not.toContain('Invoices');
    });
  });
});

describe('a CLI for a server with tools of its own beside the Skilled OpenAPI plugin', () => {
  let project: SkilledCliProject;
  let homeDir: string;

  function run(args: string[]): CliResult {
    return runCliBundle(project.cliBundle, args, { FRONTMCP_HOME: homeDir });
  }

  beforeAll(async () => {
    project = await buildSkilledCliProject({ prefix: 'skilled-mixed', appName: 'skilled-mixed-demo', ownTool: true });
    homeDir = await mkdtemp(path.join(os.tmpdir(), 'fmcp-skm-'));
  }, 180_000);

  afterAll(async () => {
    await rm(homeDir, { recursive: true, force: true });
    await removeScratchProject(project.dir);
  });

  it('has the skill commands only under skills, beside its own tool commands', () => {
    const { stdout } = run(['--help']);

    expect(stdout.slice(stdout.indexOf('Tools:'), stdout.indexOf('Resources & Prompts:'))).toMatch(
      /^Tools:\n\s+ping\s+Answer pong\n/,
    );
    expect(stdout).toMatch(/Skills:\n\s+skills\s+Find, load and run skills/);
    expect(stdout).not.toContain('search_skill');
    expect(stdout).not.toContain('run-workflow');
    expect(run(['search_skill', 'invoices'])).toMatchObject({ exitCode: 2 });
  });

  it('serves the skills group and its own tools', () => {
    expect(run(['skills', 'search', 'invoices'])).toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining('Invoices (invoices)'),
    });
    expect(run(['skills', 'load', 'invoices']).stdout).toContain('skilled-mixed-demo skills execute getInvoice');
    expect(run(['ping'])).toMatchObject({ exitCode: 0, stdout: expect.stringContaining('pong') });
  });
});
