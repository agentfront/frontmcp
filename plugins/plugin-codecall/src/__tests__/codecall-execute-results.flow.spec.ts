/**
 * `codecall:execute` result kinds and tool errors, driven through a real server.
 *
 * In 1.8.3 a script that didn't parse and a script ended by a failing tool both came back as
 * `runtime_error`: `syntax_error` and `tool_error` were never produced. A namespace method called
 * with `{ throwOnError: false }` returned an error without the `code` that `callTool` returns, and
 * `illegal_access` line numbers in scripts that use a namespace counted the declarations CodeCall
 * wrote in front of the script.
 */
import 'reflect-metadata';

import { Client, type CallToolResult } from '@frontmcp/protocol';
import {
  App,
  createInMemoryServer,
  FrontMcpInstance,
  LogLevel,
  PublicMcpError,
  Tool,
  ToolContext,
} from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';

const executedTools: string[] = [];

function recordingTool(name: string, failure?: string) {
  @Tool({ name, description: `Runs ${name} for the results spec`, inputSchema: {} })
  class RecordingTool extends ToolContext {
    async execute() {
      executedTools.push(name);
      if (failure) {
        throw new Error(failure);
      }
      return { ran: name };
    }
  }
  return RecordingTool;
}

/** A tool whose own error, passed to the client as it is, starts like the sandbox's iteration-limit error. */
@Tool({ name: 'mail.import', description: 'Imports mail for the results spec', inputSchema: {} })
class ImportMailTool extends ToolContext {
  async execute(): Promise<never> {
    throw new PublicMcpError('Maximum iteration limit exceeded in the validation of 50000 rows');
  }
}

interface ExecuteOutcome {
  status: string;
  result?: unknown;
  error?: Record<string, unknown>;
}

describe('codecall:execute result kinds', () => {
  let client: Client;
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    @App({
      id: 'mailer',
      name: 'Mailer',
      tools: [
        recordingTool('mail.list'),
        recordingTool('mail.send'),
        recordingTool('mail.fail', `mail.fail failed at ${process.cwd()}/internal/secret.ts:12:3`),
        recordingTool('mail.slow', 'the upstream request timed out'),
        ImportMailTool,
        // Names the sandbox refuses as namespace methods or tool names: they must not break the
        // namespaces a script can use.
        recordingTool('mail.fetch'),
        recordingTool('_internal.sync'),
      ],
      plugins: [CodeCallPlugin.init({ mode: 'codecall_only' })],
    })
    class MailerApp {}

    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'codecall-results', version: '1.0.0' },
      apps: [MailerApp],
      logging: { level: LogLevel.Off },
    });
    const scope = instance.getScopes()[0];
    if (!scope) throw new Error('the server config produced no scope');
    const { clientTransport, close } = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
    client = new Client({ name: 'codecall-results-spec', version: '1.0.0' });
    await client.connect(clientTransport);
    closeServer = close;
  });

  afterAll(async () => {
    await client.close();
    await closeServer();
  });

  beforeEach(() => {
    executedTools.length = 0;
  });

  async function run(script: string, extra: Record<string, unknown> = {}): Promise<ExecuteOutcome> {
    const result = (await client.callTool({
      name: 'codecall:execute',
      arguments: { script, ...extra },
    })) as CallToolResult;
    if (result.structuredContent) return result.structuredContent as unknown as ExecuteOutcome;
    const [first] = result.content;
    if (first?.type !== 'text') throw new Error('the tool returned no text content');
    return JSON.parse(first.text) as ExecuteOutcome;
  }

  describe('syntax_error', () => {
    it("reports a script that doesn't parse, at the line and column of the mistake", async () => {
      const outcome = await run('const a = 1;\nreturn a +;');

      expect(outcome.status).toBe('syntax_error');
      expect(outcome.error?.['message']).toMatch(/Unexpected token/);
      expect(outcome.error?.['location']).toEqual({ line: 2, column: 10 });
      expect(executedTools).toEqual([]);
    });

    it('reports the same position in a script that uses a namespace', async () => {
      const outcome = await run('const r = await mail.list({});\nreturn r +;');

      expect(outcome.status).toBe('syntax_error');
      expect(outcome.error?.['location']).toEqual({ line: 2, column: 10 });
    });
  });

  describe('tool_error', () => {
    it('reports a failing tool the script did not catch', async () => {
      const outcome = await run("const r = await callTool('mail.list', {});\nreturn await callTool('mail.fail', {});");

      expect(outcome).toEqual({
        status: 'tool_error',
        error: {
          source: 'tool',
          toolName: 'mail.fail',
          message: 'Tool "mail.fail" execution failed',
          code: 'EXECUTION',
        },
      });
    });

    it('reports a failing namespace call the same way', async () => {
      const outcome = await run('return await mail.fail({});');

      expect(outcome.status).toBe('tool_error');
      expect(outcome.error).toMatchObject({ source: 'tool', toolName: 'mail.fail', code: 'EXECUTION' });
    });

    it('reports a tool that timed out, although the script did not run out of time', async () => {
      const outcome = await run("return await callTool('mail.slow', {});");

      expect(outcome.status).toBe('tool_error');
      expect(outcome.error).toMatchObject({ toolName: 'mail.slow', code: 'TIMEOUT' });
    });

    it("keeps a tool's error that reads like the sandbox's iteration limit", async () => {
      const outcome = await run("return await callTool('mail.import', {});");

      expect(outcome).toEqual({
        status: 'tool_error',
        error: {
          source: 'tool',
          toolName: 'mail.import',
          message: 'Maximum iteration limit exceeded in the validation of 50000 rows',
          code: 'VALIDATION',
        },
      });
    });

    it('reports a tool call the policy refused', async () => {
      const outcome = await run("return await callTool('mail.send', { to: 'x' });", { allowedTools: ['mail.list'] });

      expect(outcome.status).toBe('tool_error');
      expect(outcome.error).toMatchObject({ toolName: 'mail.send', code: 'ACCESS_DENIED' });
      expect(executedTools).toEqual([]);
    });
  });

  describe('runtime_error', () => {
    it("reports the script's own error after it caught a tool failure", async () => {
      const outcome = await run(
        'try {\n  await mail.fail({});\n} catch (e) {}\nconst r = await mail.list({});\nreturn r.nope.deeper;',
      );

      expect(outcome.status).toBe('runtime_error');
      expect(outcome.error).toMatchObject({ source: 'script', name: 'TypeError' });
    });

    it('reports a value the script throws', async () => {
      const outcome = await run('const r = await mail.list({});\nthrow "nope";');

      expect(outcome.status).toBe('runtime_error');
      expect(outcome.error?.['message']).toBe('nope');
    });
  });

  describe('callTool and namespace methods', () => {
    it('return the same error with { throwOnError: false }', async () => {
      const outcome = await run(
        "const viaCallTool = await callTool('mail.fail', {}, { throwOnError: false });\n" +
          'const viaNamespace = await mail.fail({}, { throwOnError: false });\n' +
          'return { viaCallTool, viaNamespace };',
      );

      expect(outcome.status).toBe('ok');
      const result = outcome.result as { viaCallTool: unknown; viaNamespace: unknown };
      expect(result.viaNamespace).toEqual(result.viaCallTool);
      expect(result.viaNamespace).toEqual({
        success: false,
        error: expect.objectContaining({
          message: 'Tool "mail.fail" execution failed',
          toolName: 'mail.fail',
          code: 'EXECUTION',
        }),
      });
    });

    it('report the same illegal_access line numbers', async () => {
      const body = '\nlet page = 1;\nwhile (page < 3) { page++; }\nreturn a;';
      const viaNamespace = await run(`const a = await mail.list({});${body}`);
      const viaCallTool = await run(`const a = await callTool('mail.list', {});${body}`);

      expect(viaNamespace.status).toBe('illegal_access');
      expect(viaNamespace.error?.['message']).toEqual(viaCallTool.error?.['message']);
    });

    it.each([
      ['on its own lines', 'const x = 1;\nlet page = 1;\nwhile (page < 3) { page++; }\nreturn x;', 3],
      ['after a block written on one line', 'if (1) { const u = 1; const v = 2; }\nwhile (true) { break; }', 2],
      ['after statements written on one line', 'const q = 1; const r = 2; const s = 3;\nwhile (true) { break; }', 2],
      ['after comments and blank lines', '// count the pages\n\n\nwhile (true) { break; }', 4],
      [
        'in a script that uses a namespace',
        'const a = await mail.list({});\nlet p = 1;\nwhile (p < 3) { p++; }\nreturn a;',
        3,
      ],
      ['on the first line', 'while (true) { break; }', 1],
    ])('report illegal_access at the line of the script itself: a loop %s', async (_label, script, line) => {
      const outcome = await run(script);

      expect(outcome.status).toBe('illegal_access');
      const message = String(outcome.error?.['message']);
      const lines = [...message.matchAll(/\(line (\d+)\)/g)].map((match) => Number(match[1]));
      expect(lines.length).toBeGreaterThan(0);
      expect(new Set(lines)).toEqual(new Set([line]));
    });

    it('keep working when other tools have names the sandbox refuses as namespaces', async () => {
      const outcome = await run(
        "const listed = await mail.list();\nconst fetched = await callTool('mail.fetch', {});\n" +
          "const synced = await callTool('_internal.sync', {});\nreturn [listed, fetched, synced];",
      );

      expect(outcome).toEqual({
        status: 'ok',
        result: [{ ran: 'mail.list' }, { ran: 'mail.fetch' }, { ran: '_internal.sync' }],
      });
    });
  });
});
