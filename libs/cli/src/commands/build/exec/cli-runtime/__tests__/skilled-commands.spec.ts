import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';

import { Command, CommanderError } from 'commander';

import { mkdtemp, rm, writeFile } from '@frontmcp/utils';

import { registerSkilledCommands, SKILLED_OPENAPI_TOOLS, type SkilledClient } from '../skilled-commands';

type ToolAnswer = Awaited<ReturnType<SkilledClient['callTool']>>;

const ALL_TOOLS = Object.values(SKILLED_OPENAPI_TOOLS);

const SEARCH_ANSWER: ToolAnswer = {
  content: [{ type: 'text', text: '{}' }],
  structuredContent: {
    skills: [{ skillId: 'invoices', name: 'Invoices', description: 'Look up invoices.', score: 0.8312 }],
  },
};

const INVOICES_SKILL = {
  id: 'invoices',
  name: 'Invoices',
  description: 'Look up invoices.',
  instructions: '# Invoices\n\nFind an invoice by its id.',
  actions: [
    {
      actionId: 'getInvoice',
      summary: 'Get an invoice by id.',
      inputJsonSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, expand: { type: 'boolean' } },
        required: ['id'],
      },
    },
    {
      actionId: 'listInvoices',
      summary: 'List invoices.',
      inputJsonSchema: { type: 'object', properties: { status: { type: 'string', enum: ['paid', 'open'] } } },
    },
    {
      actionId: 'createInvoice',
      summary: 'Create an invoice.',
      inputJsonSchema: {
        type: 'object',
        properties: {
          customer: { type: 'string', examples: ["O'Brien"] },
          amount: { type: ['integer', 'null'] },
          lines: { type: 'array' },
          address: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
          currency: { type: 'string', default: 'EUR' },
        },
        required: ['customer', 'amount', 'lines', 'address', 'currency'],
      },
    },
  ],
};

const INVOICE = { id: 'INV-1001', status: 'paid' };

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
  reads: string[];
  program: Command;
}

/** Run `mymcp <args>` against a client that answers each tool and resource with what the test gives. */
async function run(
  args: string[],
  setup: {
    answers?: Partial<Record<string, ToolAnswer | Error>>;
    resources?: Record<string, string>;
    topLevel?: boolean;
    toolNames?: string[];
    stdin?: string;
  } = {},
): Promise<Run> {
  const calls: Run['calls'] = [];
  const reads: string[] = [];
  const client: SkilledClient = {
    callTool: async (name, toolArgs) => {
      calls.push({ name, args: toolArgs });
      const answer = setup.answers?.[name] ?? { content: [{ type: 'text', text: 'ok' }] };
      if (answer instanceof Error) throw answer;
      return answer;
    },
    readResource: async (uri) => {
      reads.push(uri);
      const text = setup.resources?.[uri];
      if (text === undefined) throw new Error(`Resource not found: ${uri}`);
      return { contents: [{ text }] };
    },
  };
  const program = new Command('mymcp')
    .exitOverride()
    .configureOutput({ writeOut: () => undefined, writeErr: () => undefined })
    .option('--output <mode>', 'Output format', 'text')
    .option('--yes', 'Answer yes');
  registerSkilledCommands(program, {
    getClient: async () => client,
    toolNames: setup.toolNames ?? ALL_TOOLS,
    topLevel: setup.topLevel ?? true,
    stdin: Readable.from([setup.stdin ?? '']),
  });

  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = jest.spyOn(console, 'log').mockImplementation((line: string) => void stdout.push(line));
  const error = jest.spyOn(console, 'error').mockImplementation((line: string) => void stderr.push(line));
  process.exitCode = undefined;
  try {
    await program.parseAsync(['node', 'mymcp', ...args]);
  } catch (thrown) {
    if (!(thrown instanceof CommanderError)) throw thrown;
    stderr.push(thrown.code);
    process.exitCode = 2;
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  const exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0;
  process.exitCode = undefined;
  return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode, calls, reads, program };
}

describe('registerSkilledCommands', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-skilled-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('search', () => {
    it('searches with the query and its options, and lists the skills with their scores', async () => {
      const { stdout, exitCode, calls } = await run(
        ['search_skill', 'refund', 'an', 'invoice', '--limit', '5', '--tags', 'billing, refunds', '--not-query', 'void'],
        { answers: { search_skill: SEARCH_ANSWER } },
      );

      expect(exitCode).toBe(0);
      expect(calls).toEqual([
        {
          name: 'search_skill',
          args: { query: 'refund an invoice', limit: 5, tags: ['billing', 'refunds'], notQuery: 'void' },
        },
      ]);
      expect(stdout).toBe('Invoices (invoices)  score 0.83\n  Look up invoices.\n\nLoad one: mymcp load_skill <skillId>');
    });

    it('answers to its kebab-case name and the 1.11.0 --query flag', async () => {
      const { calls } = await run(['search-skill', '--query', 'refunds'], { answers: { search_skill: SEARCH_ANSWER } });

      expect(calls[0].args).toEqual({ query: 'refunds' });
    });

    it("prints the tool's structured content with --output json", async () => {
      const { stdout } = await run(['--output', 'json', 'search_skill', 'refunds'], {
        answers: { search_skill: SEARCH_ANSWER },
      });

      expect(JSON.parse(stdout)).toEqual(SEARCH_ANSWER.structuredContent);
    });

    it('says when no skill matches', async () => {
      const { stdout } = await run(['search_skill', 'refunds'], {
        answers: { search_skill: { structuredContent: { skills: [] } } },
      });

      expect(stdout).toBe('No skills found.');
    });

    it.each([
      [[], 'say what you want to do, as in: mymcp search_skill "refund an invoice"'],
      [['refunds', '--limit', '0'], '--limit takes a positive whole number, not "0"'],
    ])('exits 2 for %j, sending nothing', async (args, message) => {
      const { stderr, exitCode, calls } = await run(['search_skill', ...args]);

      expect(exitCode).toBe(2);
      expect(stderr).toBe(`Error: ${message}`);
      expect(calls).toEqual([]);
    });
  });

  describe('load', () => {
    it("loads one skill by skillId, and prints its instructions and actions with a ready command for each", async () => {
      const { stdout, exitCode, calls } = await run(['load_skill', 'invoices'], {
        answers: { load_skill: { structuredContent: { skill: INVOICES_SKILL, isComplete: true } } },
      });

      expect(exitCode).toBe(0);
      expect(calls).toEqual([{ name: 'load_skill', args: { skillId: 'invoices' } }]);
      expect(stdout).toBe(
        [
          'Invoices (invoices)',
          'Look up invoices.',
          '',
          '# Invoices\n\nFind an invoice by its id.',
          '',
          'Actions (3):',
          '',
          '  getInvoice: Get an invoice by id.',
          `    mymcp execute getInvoice --input '{"id":"<id>"}'`,
          '    optional input: expand',
          '',
          '  listInvoices: List invoices.',
          '    mymcp execute listInvoices',
          '    optional input: status',
          '',
          '  createInvoice: Create an invoice.',
          `    mymcp execute createInvoice --input '{"customer":"O'\\''Brien","amount":0,"lines":[],"address":{"city":"<city>"},"currency":"EUR"}'`,
        ].join('\n'),
      );
    });

    it('loads several skills by skillIds, with the warning of an incomplete one', async () => {
      const admin = { id: 'admin', name: 'Admin', description: 'Billing administration.', instructions: '# Admin' };
      const { stdout, calls } = await run(['load-skill', 'invoices', 'admin'], {
        answers: {
          load_skill: {
            structuredContent: {
              skills: [
                { skill: { ...INVOICES_SKILL, actions: [] }, isComplete: true },
                { skill: admin, isComplete: false, warning: 'some actions are unavailable' },
              ],
            },
          },
        },
      });

      expect(calls[0].args).toEqual({ skillIds: ['invoices', 'admin'] });
      expect(stdout).toContain('Invoices (invoices)');
      expect(stdout).toContain('Admin (admin)\nBilling administration.\nWarning: some actions are unavailable\n\n# Admin');
    });

    it('takes the 1.11.0 --skill-id flag', async () => {
      const { calls } = await run(['load_skill', '--skill-id', 'invoices'], {
        answers: { load_skill: { structuredContent: { skill: INVOICES_SKILL } } },
      });

      expect(calls[0].args).toEqual({ skillId: 'invoices' });
    });

    it('exits 1 for a skill it does not find, with the error on stderr', async () => {
      const notFound: ToolAnswer = { content: [{ type: 'text', text: 'Skill "refunds" not found' }], isError: true };
      const { stdout, stderr, exitCode } = await run(['load_skill', 'refunds'], { answers: { load_skill: notFound } });

      expect(exitCode).toBe(1);
      expect(stdout).toBe('');
      expect(stderr).toBe('Error: Skill "refunds" not found');
    });

    it('prints the raw result of a failed call with --output json when it has no structured content', async () => {
      const notFound: ToolAnswer = { content: [{ type: 'text', text: 'Skill "refunds" not found' }], isError: true };
      const { stdout, exitCode } = await run(['--output', 'json', 'load_skill', 'refunds'], {
        answers: { load_skill: notFound },
      });

      expect(exitCode).toBe(1);
      expect(JSON.parse(stdout)).toEqual(notFound);
    });

    it('exits 2 without a skill to load', async () => {
      expect(await run(['load_skill'])).toMatchObject({ exitCode: 2, calls: [] });
      expect(await run(['skills', 'load'])).toMatchObject({ exitCode: 2, stderr: 'commander.missingArgument' });
    });
  });

  describe('execute', () => {
    const succeeded: ToolAnswer = {
      content: [{ type: 'text', text: JSON.stringify(INVOICE) }],
      structuredContent: INVOICE,
    };

    it("runs the action with its input and prints the action's data", async () => {
      const { stdout, exitCode, calls } = await run(['execute', 'getInvoice', '--input', '{"id":"INV-1001"}'], {
        answers: { execute_action: succeeded },
      });

      expect(exitCode).toBe(0);
      expect(calls).toEqual([{ name: 'execute_action', args: { actionId: 'getInvoice', input: { id: 'INV-1001' } } }]);
      expect(stdout).toBe(JSON.stringify(INVOICE, null, 2));
    });

    it('runs an action that takes no input, printing text data as it is', async () => {
      const { stdout, calls } = await run(['execute_action', 'ping'], {
        answers: { execute_action: { content: [{ type: 'text', text: 'pong' }], structuredContent: { value: 'pong' } } },
      });

      expect(calls[0].args).toEqual({ actionId: 'ping' });
      expect(stdout).toBe('pong');
    });

    it('reads the input from standard input with --input -', async () => {
      const { calls } = await run(['execute', 'getInvoice', '--input', '-'], {
        answers: { execute_action: succeeded },
        stdin: '{"id":"INV-2"}\n',
      });

      expect(calls[0].args).toEqual({ actionId: 'getInvoice', input: { id: 'INV-2' } });
    });

    it('reads the input from a file with --input-file', async () => {
      const inputFile = path.join(dir, 'input.json');
      await writeFile(inputFile, '{"id":"INV-3"}');

      const { calls } = await run(['execute', 'getInvoice', '--input-file', inputFile], {
        answers: { execute_action: succeeded },
      });

      expect(calls[0].args).toEqual({ actionId: 'getInvoice', input: { id: 'INV-3' } });
    });

    it('exits 1 for an action that fails, with its error on stderr and its outcome with --output json', async () => {
      const failed: ToolAnswer = {
        content: [{ type: 'text', text: 'action "getInvoice" failed with status 404: {"error":"not found"}' }],
        structuredContent: { ok: false, status: 404, data: { error: 'not found' } },
        isError: true,
      };
      const { stdout, stderr, exitCode } = await run(
        ['--output', 'json', 'execute', 'getInvoice', '--input', '{"id":"nope"}'],
        { answers: { execute_action: failed } },
      );

      expect(exitCode).toBe(1);
      expect(JSON.parse(stdout)).toEqual(failed.structuredContent);
      expect(stderr).toBe('Error: action "getInvoice" failed with status 404: {"error":"not found"}');
    });

    it('exits 2 for input the server finds invalid', async () => {
      const invalid: ToolAnswer = {
        content: [{ type: 'text', text: 'Invalid input' }],
        isError: true,
        _meta: { code: 'INVALID_INPUT' },
      };

      expect(await run(['execute', 'getInvoice'], { answers: { execute_action: invalid } })).toMatchObject({
        exitCode: 2,
      });
    });

    it.each([
      [['--input', '{"id"'], '--input is not JSON'],
      [['--input', '[1]'], `--input must be a JSON object, such as '{"id":"INV-1001"}'`],
      [['--input', '{}', '--input-file', 'input.json'], 'pass the input with --input or --input-file, not both'],
      [['--input-file', '/nowhere/input.json'], "can't read /nowhere/input.json"],
    ])('exits 2 for %j, sending nothing', async (flags, message) => {
      const { stderr, exitCode, calls } = await run(['execute', 'getInvoice', ...flags]);

      expect(exitCode).toBe(2);
      expect(stderr).toContain(`Error: ${message}`);
      expect(calls).toEqual([]);
    });

    it('takes the global --yes after the command too', async () => {
      const { program, exitCode } = await run(['execute', 'voidInvoice', '--input', '{"id":"inv_1"}', '--yes'], {
        answers: { execute_action: succeeded },
      });

      expect(exitCode).toBe(0);
      expect(program.opts()['yes']).toBe(true);
    });

    it('exits 1 with the message when the call itself fails', async () => {
      const { stderr, exitCode } = await run(['execute', 'getInvoice'], {
        answers: { execute_action: new Error('Not logged in. Run "mymcp login" first.') },
      });

      expect(exitCode).toBe(1);
      expect(stderr).toBe('Error: Not logged in. Run "mymcp login" first.');
    });
  });

  describe('run', () => {
    const ran = (value: unknown): ToolAnswer => ({
      content: [{ type: 'text', text: '{}' }],
      structuredContent: { success: true, value, stats: { durationMs: 1, toolCalls: 0, steps: 3 } },
    });
    const script = 'return 1 + 1;';

    it('runs the script given as an argument and prints its value', async () => {
      const { stdout, exitCode, calls } = await run(['run_workflow', script], { answers: { run_workflow: ran({ two: 2 }) } });

      expect(exitCode).toBe(0);
      expect(calls).toEqual([{ name: 'run_workflow', args: { script } }]);
      expect(stdout).toBe(JSON.stringify({ two: 2 }, null, 2));
    });

    it('reads the script from a file with --file', async () => {
      const scriptFile = path.join(dir, 'refund.js');
      await writeFile(scriptFile, script);

      const { calls } = await run(['run-workflow', '--file', scriptFile], { answers: { run_workflow: ran('done') } });

      expect(calls[0].args).toEqual({ script });
    });

    it('reads the script from standard input for -', async () => {
      const { stdout, calls } = await run(['run_workflow', '-'], { answers: { run_workflow: ran('done') }, stdin: script });

      expect(calls[0].args).toEqual({ script });
      expect(stdout).toBe('done');
    });

    it('takes the 1.11.0 --script flag, and prints nothing for a script that returns no value', async () => {
      const { stdout, calls } = await run(['run_workflow', '--script', script], { answers: { run_workflow: ran(undefined) } });

      expect(calls[0].args).toEqual({ script });
      expect(stdout).toBe('');
    });

    it('exits 1 for a workflow that fails, with its error on stderr', async () => {
      const failed: ToolAnswer = {
        content: [{ type: 'text', text: '{"success":false,"error":"unknown action \\"refundInvoice\\""}' }],
        structuredContent: { success: false, error: 'unknown action "refundInvoice"' },
        isError: true,
      };
      const { stderr, exitCode } = await run(['run_workflow', script], { answers: { run_workflow: failed } });

      expect(exitCode).toBe(1);
      expect(stderr).toBe('Error: unknown action "refundInvoice"');
    });

    it.each([[[]], [[script, '--file', 'refund.js']]])('exits 2 for %j: the script must come once', async (args) => {
      const { stderr, exitCode, calls } = await run(['run_workflow', ...args]);

      expect(exitCode).toBe(2);
      expect(stderr).toBe(
        'Error: give the script once: as an argument, with --file <path>, or - for standard input, as in: mymcp run_workflow --file refund.js',
      );
      expect(calls).toEqual([]);
    });
  });

  describe('the skills group', () => {
    it('serves the same commands, and hints at its own command lines when there are no top-level ones', async () => {
      const { stdout, calls } = await run(['skills', 'search', 'refunds'], {
        topLevel: false,
        answers: { search_skill: SEARCH_ANSWER },
      });

      expect(calls[0]).toEqual({ name: 'search_skill', args: { query: 'refunds' } });
      expect(stdout).toContain('Load one: mymcp skills load <skillId>');
    });

    it('runs actions and workflows', async () => {
      const execute = await run(['skills', 'execute', 'getInvoice', '--input', '{"id":"INV-1"}'], { topLevel: false });
      const runWorkflow = await run(['skills', 'run', 'return 1;'], { topLevel: false });

      expect(execute.calls[0]).toEqual({ name: 'execute_action', args: { actionId: 'getInvoice', input: { id: 'INV-1' } } });
      expect(runWorkflow.calls[0]).toEqual({ name: 'run_workflow', args: { script: 'return 1;' } });
    });

    it('has no top-level commands on a server with tools of its own', async () => {
      const { exitCode, stderr, calls } = await run(['search_skill', 'refunds'], { topLevel: false });

      expect(exitCode).toBe(2);
      expect(stderr).toBe('commander.unknownCommand');
      expect(calls).toEqual([]);
    });

    it("reads a skill's SKILL.md by its name, encoded", async () => {
      const uri = 'skill://Billing%20administration/SKILL.md';
      const { stdout, reads } = await run(['skills', 'read', 'Billing administration'], {
        resources: { [uri]: '---\nname: Billing administration\n---\n# Admin' },
      });

      expect(reads).toEqual([uri]);
      expect(stdout).toBe('---\nname: Billing administration\n---\n# Admin');
    });

    it('exits 1 when the skill to read is not found', async () => {
      const { stderr, exitCode } = await run(['skills', 'read', 'refunds']);

      expect(exitCode).toBe(1);
      expect(stderr).toBe('Error: Resource not found: skill://refunds/SKILL.md');
    });

    it('lists the skills the caller can use, from skill://index.json', async () => {
      const index = {
        skills: [
          { type: 'skill-md', name: 'Invoices', description: 'Look up invoices.', url: 'skill://Invoices/SKILL.md' },
          { type: 'mcp-resource-template', description: 'More', url: 'skill://{name}/SKILL.md' },
        ],
      };
      const resources = { 'skill://index.json': JSON.stringify(index) };

      const { stdout } = await run(['skills', 'list'], { resources });
      const json = await run(['--output', 'json', 'skills', 'list'], { resources });

      expect(stdout).toBe('Invoices\n  Look up invoices.\n\nLoad one: mymcp load_skill <name>');
      expect(JSON.parse(json.stdout)).toEqual(index);
    });

    it('says when there are no skills to list', async () => {
      const { stdout } = await run(['skills', 'list'], { resources: { 'skill://index.json': '{"skills":[]}' } });

      expect(stdout).toBe('No skills found.');
    });

    it('leaves out the command of a meta-tool the CLI does not offer', async () => {
      const program = (await run([], { toolNames: ['search_skill', 'load_skill', 'execute_action'] })).program;
      const group = program.commands.find((command) => command.name() === 'skills');

      expect(program.commands.map((command) => command.name())).toEqual(['search_skill', 'load_skill', 'execute', 'skills']);
      expect(group?.commands.map((command) => command.name())).toEqual(['search', 'load', 'execute', 'read', 'list']);
      expect(group?.description()).toBe('Find, load and run skills: search, load, execute, read, list');
    });
  });
});
