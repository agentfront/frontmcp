/**
 * E2E: `<bin> install -p claude` for a CLI whose server serves a Skilled OpenAPI bundle beside a `@Skill` of its own.
 * The shipped skill comes from the build; the bundle skills are read from the server as the caller, each with
 * commands that run as written; `--refresh-skills` rewrites only the bundle skills after the bundle changes.
 */
import { createServer } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import { chmod, fileExists, mkdtemp, readFile, rm, symlink, writeFile } from '@frontmcp/utils';

import { removeScratchProject } from './helpers/dev-cli';
import { runShellAsync, type CliResult } from './helpers/exec-cli';
import { buildSkilledCliProject, SKILLED_BUNDLE, type SkilledCliProject } from './helpers/skilled-cli-project';

const APP_NAME = 'skilled-install-demo';
const INVOICE = { id: 'inv_1', status: 'paid' };

const getInvoice = {
  ...SKILLED_BUNDLE.operations.getInvoice,
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', examples: ['inv_1'] } },
    required: ['id'],
  },
};

function bundleAt(version: string, skills: Array<Record<string, unknown>>): Record<string, unknown> {
  return { ...SKILLED_BUNDLE, version, skills, operations: { getInvoice } };
}

const INVOICES_SKILL = {
  id: 'invoices',
  name: 'Invoices',
  description: 'Look up invoices.',
  instructions: '# Invoices\n\nFind an invoice by its id.',
  operationIds: ['getInvoice'],
};
const GUARDED_SKILL = {
  id: 'guarded',
  name: 'Guarded action',
  description: 'Check an invoice before acting on it.',
  instructions: '# Guarded action\n\nRead the invoice first.',
  operationIds: ['getInvoice'],
};
const ADMIN_SKILL = {
  ...INVOICES_SKILL,
  id: 'admin',
  name: 'Admin',
  requiredAuthorities: { roles: { any: ['admin'] } },
};

describe('install -p claude for a CLI whose server serves a Skilled OpenAPI bundle', () => {
  let project: SkilledCliProject;
  let homeDir: string;
  let binDir: string;
  let destRoot: string;
  const apiRequests: string[] = [];
  const invoiceApi = createServer((req, res) => {
    apiRequests.push(`${req.method} ${req.url}`);
    const found = req.url === '/v1/invoices/inv_1';
    res.writeHead(found ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(found ? INVOICE : { error: 'invoice not found' }));
  });

  const pluginDir = () => path.join(destRoot, APP_NAME);
  const skillMd = (folder: string) => readFile(path.join(pluginDir(), 'skills', folder, 'SKILL.md'));

  // Run by its name from a PATH directory, as an installed CLI is, so the skills name it as an agent runs it
  function runByName(commandLine: string): Promise<CliResult> {
    return runShellAsync(commandLine, project.dir, {
      FRONTMCP_HOME: homeDir,
      PATH: `${binDir}${path.delimiter}${process.env['PATH'] ?? ''}`,
    });
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => invoiceApi.listen(0, '127.0.0.1', resolve));
    const address = invoiceApi.address();
    if (!address || typeof address === 'string') throw new Error('the invoice API has no port');
    project = await buildSkilledCliProject({
      prefix: 'skilled-install',
      appName: APP_NAME,
      serviceBaseUrl: `http://127.0.0.1:${address.port}/v1`,
      shippedSkill: true,
      bundle: bundleAt('1.0.0', [INVOICES_SKILL, GUARDED_SKILL, ADMIN_SKILL]),
    });
    homeDir = await mkdtemp(path.join(os.tmpdir(), 'fmcp-ski-'));
    binDir = await mkdtemp(path.join(os.tmpdir(), 'fmcp-ski-bin-'));
    destRoot = await mkdtemp(path.join(os.tmpdir(), 'fmcp-ski-plugins-'));
    await chmod(project.cliBundle, 0o755);
    await symlink(project.cliBundle, path.join(binDir, APP_NAME));
  }, 180_000);

  afterAll(async () => {
    await new Promise((resolve) => invoiceApi.close(resolve));
    for (const dir of [homeDir, binDir, destRoot]) await rm(dir, { recursive: true, force: true });
    await removeScratchProject(project.dir);
  });

  beforeEach(() => {
    apiRequests.length = 0;
  });

  it('keeps the bundle skills out of the build: bin-meta.json lists only the shipped skill', async () => {
    const meta = JSON.parse(await readFile(path.join(path.dirname(project.cliBundle), 'bin-meta.json'))) as {
      skills: Array<{ name: string }>;
    };

    expect(meta.skills.map((skill) => skill.name)).toEqual(['billing-guide']);
  });

  it('--dry-run lists the shipped and the bundle skills it would write, and writes nothing', async () => {
    const { stdout, exitCode } = await runByName(`${APP_NAME} install -p claude --dir '${destRoot}' --dry-run`);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('[install:claude] dry-run plan');
    expect(stdout).toContain('  shipped skills: billing-guide');
    expect(stdout).toContain('  bundle skills (bundle 1.0.0): guarded-action (Guarded action), invoices (Invoices)');
    expect(stdout).toContain(`+ ${path.join(pluginDir(), 'skills', 'guarded-action', 'SKILL.md')}`);
    expect(await fileExists(pluginDir())).toBe(false);
  });

  it("writes the shipped skill and the caller's bundle skills, a name with a space in a kebab-case folder", async () => {
    const { stdout, exitCode } = await runByName(`${APP_NAME} install -p claude --dir '${destRoot}'`);

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`✓ Wrote ${pluginDir()}/ (3 skills, 0 commands, 1 MCP server)`);
    const manifest = JSON.parse(await readFile(path.join(pluginDir(), '.claude-plugin', 'plugin.json')));
    expect(manifest.skills).toEqual(['billing-guide', 'guarded-action', 'invoices']);
    expect(manifest._meta.frontmcp.bundleSkills).toEqual({
      bundleVersion: '1.0.0',
      skills: ['guarded-action', 'invoices'],
    });
    expect(await skillMd('billing-guide')).toContain('Invoices are due in 30 days.');

    const guarded = await skillMd('guarded-action');
    expect(guarded).toMatch(/^---\nname: Guarded action\ndescription: Check an invoice before acting on it\.\n/);
    expect(guarded).toContain('metadata:\n  source: "skilled-openapi-bundle"\n  bundle-version: "1.0.0"\n');
    expect(guarded).toContain(
      `from version 1.0.0 of the server's skill bundle. Don't edit it: after the bundle changes, run ` +
        `\`${APP_NAME} install -p claude --dir ${destRoot} --refresh-skills\` to write it again.`,
    );
    expect(guarded).toContain('# Guarded action\n\nRead the invoice first.');
    expect(guarded).toContain(
      `### getInvoice\n\nGet an invoice by id.\n\n\`\`\`bash\n${APP_NAME} execute getInvoice --input '{"id":"inv_1"}'\n\`\`\``,
    );
    expect(guarded).toContain(`${APP_NAME} run_workflow 'return await callTool("getInvoice", {"id":"inv_1"});'`);
  });

  it('leaves out the bundle skill the caller may not use', async () => {
    expect(await fileExists(path.join(pluginDir(), 'skills', 'admin'))).toBe(false);
  });

  it("runs a SKILL.md's execute and run_workflow commands as written", async () => {
    const commands = (await skillMd('invoices')).split('\n').filter((line) => line.startsWith(`${APP_NAME} `));
    expect(commands).toHaveLength(2);

    const executed = await runByName(commands[0]);
    const workflow = await runByName(commands[1]);

    expect(executed.exitCode).toBe(0);
    expect(JSON.parse(executed.stdout)).toEqual(INVOICE);
    expect(workflow.exitCode).toBe(0);
    expect(JSON.parse(workflow.stdout)).toEqual(INVOICE);
    expect(apiRequests).toEqual(['GET /v1/invoices/inv_1', 'GET /v1/invoices/inv_1']);
  });

  it('--status lists the installed skills by kind', async () => {
    const { stdout, exitCode } = await runByName(`${APP_NAME} install --status --dir '${destRoot}'`);

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/claude:\s+installed v1\.0\.0/);
    expect(stdout).toContain('shipped skills: billing-guide');
    expect(stdout).toContain('bundle skills (bundle 1.0.0): guarded-action, invoices');
  });

  describe('after the bundle changes', () => {
    beforeAll(async () => {
      const changedInvoices = {
        ...INVOICES_SKILL,
        instructions: '# Invoices\n\nFind an invoice by its id, then check its status.',
      };
      const refunds = { ...INVOICES_SKILL, id: 'refunds', name: 'Refunds', description: 'Refund invoices.' };
      await writeFile(
        project.bundlePath,
        JSON.stringify({
          ...bundleAt('1.1.0', [changedInvoices, refunds, ADMIN_SKILL]),
          services: (JSON.parse(await readFile(project.bundlePath)) as { services: unknown }).services,
        }),
      );
      await writeFile(path.join(pluginDir(), 'skills', 'billing-guide', 'SKILL.md'), 'edited by hand');
    });

    it('--refresh-skills --dry-run plans the change and writes nothing', async () => {
      const { stdout, exitCode } = await runByName(
        `${APP_NAME} install --refresh-skills --dir '${destRoot}' --dry-run`,
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain(
        `[install:claude] dry-run plan: refresh the bundle skills in ${pluginDir()} from bundle 1.1.0`,
      );
      expect(stdout).toContain('1 added (refunds), 1 updated (invoices), 1 removed (guarded-action)');
      expect(await fileExists(path.join(pluginDir(), 'skills', 'guarded-action'))).toBe(true);
    });

    it('--refresh-skills rewrites the bundle skills and removes the one that is gone, leaving the shipped skill', async () => {
      const { stdout, exitCode } = await runByName(`${APP_NAME} install --refresh-skills --dir '${destRoot}'`);

      expect(exitCode).toBe(0);
      expect(stdout).toContain(
        `✓ Refreshed the bundle skills in ${pluginDir()} from bundle 1.1.0: 1 added (refunds), 1 updated (invoices), 1 removed (guarded-action)`,
      );
      expect(await fileExists(path.join(pluginDir(), 'skills', 'guarded-action'))).toBe(false);
      expect(await skillMd('invoices')).toContain('then check its status.');
      expect(await skillMd('invoices')).toContain('bundle-version: "1.1.0"');
      expect(await skillMd('refunds')).toContain('name: Refunds');
      expect(await skillMd('billing-guide')).toBe('edited by hand');
      const manifest = JSON.parse(await readFile(path.join(pluginDir(), '.claude-plugin', 'plugin.json')));
      expect(manifest.skills).toEqual(['billing-guide', 'invoices', 'refunds']);
    });
  });
});
