/**
 * The code a script sees for a tool call the server refused: an input that fails the tool's schema
 * is `VALIDATION`, and a call over a rate limit, quota or concurrency limit is `RATE_LIMITED`, not
 * `EXECUTION`.
 *
 * The code comes from the error's type, never its words, and the script gets the message an MCP client
 * would be told (#1166): a tool failing with `User u9 not found` was reported as `Tool "x" was not found`.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { type CallToolResult } from '@frontmcp/protocol';
import { Client } from '@frontmcp/protocol/client';
import {
  App,
  createInMemoryServer,
  FrontMcpInstance,
  LogLevel,
  PublicMcpError,
  QuotaExceededError,
  Tool,
  ToolContext,
} from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';

@Tool({ name: 'users.get', description: 'Gets a user by id', inputSchema: { id: z.string() } })
class GetUserTool extends ToolContext {
  async execute({ id }: { id: string }) {
    return { id };
  }
}

@Tool({
  name: 'users.export',
  description: 'Exports users, once a minute',
  inputSchema: {},
  rateLimit: { maxRequests: 1, windowMs: 60_000 },
})
class ExportUsersTool extends ToolContext {
  async execute() {
    return { exported: true };
  }
}

@Tool({ name: 'billing.charge', description: 'Charges a card', inputSchema: {} })
class ChargeTool extends ToolContext {
  async execute(): Promise<{ charged: boolean }> {
    throw new QuotaExceededError('billing');
  }
}

@Tool({
  name: 'reports.build',
  description: 'Builds a report, one at a time',
  inputSchema: {},
  concurrency: { maxConcurrent: 1 },
})
class BuildReportTool extends ToolContext {
  async execute() {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { built: true };
  }
}

@Tool({ name: 'users.find', description: 'Finds a user', inputSchema: {} })
class FindUserTool extends ToolContext {
  async execute(): Promise<never> {
    throw new PublicMcpError('User u9 not found', 'USER_NOT_FOUND', 404);
  }
}

@Tool({ name: 'users.import', description: 'Imports users', inputSchema: {} })
class ImportUsersTool extends ToolContext {
  async execute(): Promise<never> {
    throw new PublicMcpError('The validation of row 7 failed: the import timed out at 10:30:00');
  }
}

@Tool({ name: 'users.sync', description: 'Syncs users', inputSchema: {} })
class SyncUsersTool extends ToolContext {
  async execute(): Promise<never> {
    throw new Error('sync not found: connection to postgres://admin:secret@db timed out');
  }
}

@Tool({ name: 'users.archive', description: 'Archives a user', inputSchema: {} })
class ArchiveUserTool extends ToolContext {
  async execute(): Promise<CallToolResult> {
    return { isError: true, content: [{ type: 'text', text: 'User u9 not found' }] };
  }
}

@Tool({ name: 'users.slow', description: 'Answers slowly', inputSchema: {}, timeout: { executeMs: 50 } })
class SlowUsersTool extends ToolContext {
  async execute() {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return { slow: true };
  }
}

describe('error codes a script sees', () => {
  let client: Client;
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    @App({
      id: 'users',
      name: 'Users',
      tools: [
        GetUserTool,
        ExportUsersTool,
        ChargeTool,
        BuildReportTool,
        FindUserTool,
        ImportUsersTool,
        SyncUsersTool,
        ArchiveUserTool,
        SlowUsersTool,
      ],
      plugins: [CodeCallPlugin.init({ mode: 'codecall_only' })],
    })
    class UsersApp {}

    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'codecall-error-codes', version: '1.0.0' },
      apps: [UsersApp],
      logging: { level: LogLevel.Off },
    });
    const scope = instance.getScopes()[0];
    if (!scope) throw new Error('the server config produced no scope');
    const { clientTransport, close } = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
    client = new Client({ name: 'codecall-error-codes-spec', version: '1.0.0' });
    await client.connect(clientTransport);
    closeServer = close;
  });

  afterAll(async () => {
    await client.close();
    await closeServer();
  });

  async function run(script: string): Promise<{ status: string; result?: unknown; error?: unknown }> {
    const result = (await client.callTool({ name: 'codecall:execute', arguments: { script } })) as CallToolResult;
    return result.structuredContent as unknown as { status: string; result?: unknown; error?: unknown };
  }

  it('is VALIDATION for an input the tool refuses', async () => {
    const outcome = await run(
      "const r = await callTool('users.get', { id: 42 }, { throwOnError: false });\nreturn r.error;",
    );

    expect(outcome.status).toBe('ok');
    expect(outcome.result).toEqual(expect.objectContaining({ code: 'VALIDATION', toolName: 'users.get' }));
    expect((outcome.result as { message: string }).message).toMatch(/^Invalid tool input/);
  });

  it('is RATE_LIMITED for a call over the tool rate limit', async () => {
    const outcome = await run(
      "await callTool('users.export', {}, { throwOnError: false });\n" +
        "const r = await callTool('users.export', {}, { throwOnError: false });\nreturn r.error;",
    );

    expect(outcome.status).toBe('ok');
    expect(outcome.result).toEqual(expect.objectContaining({ code: 'RATE_LIMITED', toolName: 'users.export' }));
  });

  it('is RATE_LIMITED for a call over a quota', async () => {
    const outcome = await run(
      "const r = await callTool('billing.charge', {}, { throwOnError: false });\nreturn r.error;",
    );

    expect(outcome.result).toEqual(
      expect.objectContaining({
        code: 'RATE_LIMITED',
        message: 'billing quota exceeded',
        toolName: 'billing.charge',
      }),
    );
  });

  it('is RATE_LIMITED for a call over a concurrency limit', async () => {
    const outcome = await run(
      "const rows = await parallel([1, 2], () => callTool('reports.build', {}, { throwOnError: false }));\n" +
        'return rows.map((r) => (r.success ? "ok" : r.error.code));',
    );

    expect(outcome.status).toBe('ok');
    expect(outcome.result).toEqual(expect.arrayContaining(['ok', 'RATE_LIMITED']));
  });

  async function failedCall(toolName: string): Promise<unknown> {
    const outcome = await run(`const r = await callTool('${toolName}', {}, { throwOnError: false });\nreturn r.error;`);
    return outcome.result;
  }

  it("gives the tool's own message, and reads the code from the error, not its words", async () => {
    expect(await failedCall('users.find')).toEqual(
      expect.objectContaining({ code: 'EXECUTION', message: 'User u9 not found', toolName: 'users.find' }),
    );
    expect(await failedCall('users.import')).toEqual(
      expect.objectContaining({
        code: 'EXECUTION',
        message: 'The validation of row 7 failed: the import timed out at 10:30:00',
        toolName: 'users.import',
      }),
    );
  });

  it('gives the text of an error result the tool returns, as an MCP client sees it', async () => {
    expect(await failedCall('users.archive')).toEqual(
      expect.objectContaining({ code: 'EXECUTION', message: 'User u9 not found', toolName: 'users.archive' }),
    );
  });

  it("keeps an internal error's message from the script", async () => {
    expect(await failedCall('users.sync')).toEqual(
      expect.objectContaining({ code: 'EXECUTION', message: 'Tool "users.sync" execution failed' }),
    );
  });

  it("is TIMEOUT for a call over the tool's execution timeout", async () => {
    expect(await failedCall('users.slow')).toEqual(
      expect.objectContaining({
        code: 'TIMEOUT',
        toolName: 'users.slow',
        message: expect.stringMatching(/timed out after 50ms/),
      }),
    );
  });

  it('is the tool_error code when the script does not catch the failure', async () => {
    const outcome = await run("return await callTool('billing.charge', {});");

    expect(outcome.status).toBe('tool_error');
    expect(outcome.error).toEqual(expect.objectContaining({ toolName: 'billing.charge', code: 'RATE_LIMITED' }));
  });
});
