/**
 * Run records through a real server: each `codecall:execute` leaves one record with a journal entry per tool call,
 * readable only by its owner until its TTL, the same on both runtimes and on memory and SQLite storage.
 */
import 'reflect-metadata';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { App, connect, LogLevel, Tool, ToolContext, z, type CallToolResult, type DirectClient } from '@frontmcp/sdk';
import { canonicalJson, mkdtemp, rm, sha256Hex, type StorageConfig } from '@frontmcp/utils';

import CodeCallPlugin from '../codecall.plugin';
import type { CodeCallPluginOptionsInput, CodeCallVmRuntime } from '../codecall.types';
import { jsonBytes } from '../runs/run-journal';
import { CodeCallRunStoreToken, type CodeCallRunRecord } from '../runs/run-record.types';

// The first script a test worker runs includes the sandbox's cold start.
jest.setTimeout(30000);

@Tool({ name: 'users.get', description: 'Gets a user for the run record spec', inputSchema: { id: z.number() } })
class GetUserTool extends ToolContext {
  async execute({ id }: { id: number }) {
    return { id, name: `user-${id}` };
  }
}

@Tool({ name: 'users.fail', description: 'Fails for the run record spec', inputSchema: {} })
class FailingTool extends ToolContext {
  async execute(): Promise<never> {
    throw new Error('internal');
  }
}

@Tool({ name: 'users.slow', description: 'Answers late for the run record spec', inputSchema: {} })
class SlowTool extends ToolContext {
  async execute() {
    await new Promise((resolve) => setTimeout(resolve, 800));
    return { slow: true };
  }
}

@Tool({
  name: 'runs.read',
  description: "Reads a run record as the caller's owner",
  inputSchema: { runId: z.string() },
  codecall: { visibleInListTools: true, enabledInCodeCall: false },
})
class ReadRunTool extends ToolContext {
  async execute({ runId }: { runId: string }) {
    const record = await this.get(CodeCallRunStoreToken).read(runId, this);
    return { record: record ?? null };
  }
}

interface ExecuteOutcome {
  status: string;
  runId?: string;
  result?: unknown;
}

function serverConfig(options: CodeCallPluginOptionsInput) {
  @App({
    id: 'people',
    name: 'People',
    tools: [GetUserTool, FailingTool, SlowTool, ReadRunTool],
    plugins: [CodeCallPlugin.init({ mode: 'codecall_only', ...options })],
  })
  class PeopleApp {}

  return {
    info: { name: 'codecall-run-record', version: '1.0.0' },
    apps: [PeopleApp],
    logging: { level: LogLevel.Off },
  };
}

function structuredOf<T>(result: CallToolResult): T {
  if (result.structuredContent) return result.structuredContent as T;
  const [first] = result.content;
  if (first?.type !== 'text') throw new Error('the tool returned no text content');
  return JSON.parse(first.text) as T;
}

async function execute(client: DirectClient, script: string, extra: Record<string, unknown> = {}) {
  return structuredOf<ExecuteOutcome>(
    (await client.callTool('codecall:execute', { script, ...extra })) as CallToolResult,
  );
}

async function readRun(client: DirectClient, runId: string): Promise<CodeCallRunRecord | null> {
  const answer = structuredOf<{ record: CodeCallRunRecord | null }>(
    (await client.callTool('runs.read', { runId })) as CallToolResult,
  );
  return answer.record;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RUNTIMES: CodeCallVmRuntime[] = ['node-vm', 'interpreter'];

let dir: string;
const clients: DirectClient[] = [];

async function open(config: ReturnType<typeof serverConfig>, id: string, subject?: string) {
  const client = await connect(config, { session: { id, ...(subject && { user: { sub: subject } }) } });
  clients.push(client);
  return client;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'codecall-run-record-'));
});

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe.each(RUNTIMES)('codecall:execute run records on the %s runtime', (runtime) => {
  describe.each<[string, () => StorageConfig]>([
    ['memory', () => ({ type: 'memory' })],
    ['sqlite', () => ({ type: 'sqlite', sqlite: { path: join(dir, `runs-${runtime}.sqlite`) } })],
  ])('with %s storage', (_, storage) => {
    let config: ReturnType<typeof serverConfig>;

    beforeAll(() => {
      config = serverConfig({ vm: { preset: 'secure', runtime }, runs: { storage: storage(), ttlSeconds: 60 } });
    });

    const script =
      "const a = await callTool('users.get', { id: 1 });\n" +
      "const b = await callTool('users.get', { id: 2 });\n" +
      'const c = await users.get({ id: 3 });\n' +
      'return [a.name, b.name, c.name];';

    it('keeps one record with a journal entry per tool call, which only its owner reads', async () => {
      const owner = await open(config, 'owner-session', 'alice');
      const outcome = await execute(owner, script);

      expect(outcome).toMatchObject({ status: 'ok', runId: expect.stringMatching(UUID) });
      const record = await readRun(owner, outcome.runId ?? '');
      expect(record).toMatchObject({
        runId: outcome.runId,
        owner: { session: 'owner-session', caller: 'alice' },
        scriptHash: sha256Hex(script),
        status: 'ok',
        reviewDecision: null,
        resultBytes: jsonBytes(['user-1', 'user-2', 'user-3']),
      });
      expect(Date.parse(record?.endedAt ?? '')).toBeGreaterThanOrEqual(Date.parse(record?.startedAt ?? ''));
      expect(record?.journal).toEqual(
        [1, 2, 3].map((id) => ({
          position: id,
          tool: 'users.get',
          argumentsHash: sha256Hex(canonicalJson({ id })),
          outcome: 'success',
          durationMs: expect.any(Number),
          resultBytes: jsonBytes({ id, name: `user-${id}` }),
          result: { id, name: `user-${id}` },
        })),
      );

      const otherSession = await open(config, 'other-session', 'alice');
      const otherCaller = await open(config, 'owner-session', 'mallory');
      expect(await readRun(otherSession, outcome.runId ?? '')).toBeNull();
      expect(await readRun(otherCaller, outcome.runId ?? '')).toBeNull();
    });

    it("keeps each call's result and what the script read from the clock and Math.random()", async () => {
      const owner = await open(config, 'reads-session');
      const outcome = await execute(
        owner,
        "const at = Date.now();\nconst user = await callTool('users.get', { id: Math.floor(Math.random() * 3) + 1 });\nreturn [at, user.id];",
      );

      const record = await readRun(owner, outcome.runId ?? '');
      const [at, id] = outcome.result as [number, number];
      expect(record).toMatchObject({ clock: [at], random: [expect.any(Number)] });
      expect(record?.journal[0].result).toEqual({ id, name: `user-${id}` });
    });

    it('forgets a record after its TTL', async () => {
      const owner = await open(config, 'ttl-session');
      const outcome = await execute(owner, script);
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);

      expect(await readRun(owner, outcome.runId ?? '')).toBeNull();
    });
  });

  describe('a run that fails', () => {
    let config: ReturnType<typeof serverConfig>;
    let shortTimeoutConfig: ReturnType<typeof serverConfig>;

    beforeAll(() => {
      config = serverConfig({ vm: { preset: 'secure', runtime }, runs: { storage: { type: 'memory' } } });
      shortTimeoutConfig = serverConfig({
        vm: { preset: 'secure', runtime, timeoutMs: 300 },
        runs: { storage: { type: 'memory' } },
      });
    });

    it('records where each failed call failed, and the run status', async () => {
      const client = await open(config, 'failing-session');
      const outcome = await execute(
        client,
        "await callTool('users.get', { id: 1 });\n" +
          "await callTool('users.get', { id: 'one' }, { throwOnError: false });\n" +
          "await callTool('users.slow', {}, { throwOnError: false });\n" +
          "return await callTool('users.fail', {});",
        { allowedTools: ['users.get', 'users.fail'] },
      );

      expect(outcome.status).toBe('tool_error');
      const record = await readRun(client, outcome.runId ?? '');
      expect(record?.status).toBe('tool_error');
      expect(record).not.toHaveProperty('resultBytes');
      expect(
        record?.journal.map(({ position, tool, outcome: callOutcome, phase }) => [position, tool, callOutcome, phase]),
      ).toEqual([
        [1, 'users.get', 'success', undefined],
        [2, 'users.get', 'failure', 'input'],
        [3, 'users.slow', 'failure', 'access'],
        [4, 'users.fail', 'failure', 'execute'],
      ]);
    });

    it('leaves a call still running when the script timed out unfinished', async () => {
      const client = await open(shortTimeoutConfig, 'timeout-session');
      const outcome = await execute(client, "return await callTool('users.slow', {});");

      expect(outcome.status).toBe('timeout');
      const record = await readRun(client, outcome.runId ?? '');
      expect(record?.status).toBe('timeout');
      expect(record?.journal).toEqual([
        expect.objectContaining({ position: 1, tool: 'users.slow', outcome: 'unfinished' }),
      ]);
    });
  });
});

describe('run record options', () => {
  it('keeps each call result in its journal entry with runs.resume', async () => {
    const config = serverConfig({ runs: { storage: { type: 'memory' }, resume: true } });
    const client = await open(config, 'resume-session');
    const outcome = await execute(client, "return await callTool('users.get', { id: 4 });");

    const record = await readRun(client, outcome.runId ?? '');
    expect(record?.journal[0]?.result).toEqual({ id: 4, name: 'user-4' });
  });

  it('keeps no record and returns no run id when its metadata alone is over runs.maxRecordBytes', async () => {
    const config = serverConfig({ runs: { storage: { type: 'memory' }, maxRecordBytes: 1024 } });
    const client = await open(config, 's'.repeat(2048));
    const outcome = await execute(client, "return await callTool('users.get', { id: 6 });");

    expect(outcome).toEqual({ status: 'ok', result: { id: 6, name: 'user-6' } });
  });

  it('keeps no record and returns no run id with runs.enabled false', async () => {
    const config = serverConfig({ runs: { enabled: false } });
    const client = await open(config, 'disabled-session');
    const outcome = await execute(client, "return await callTool('users.get', { id: 5 });");

    expect(outcome).toEqual({ status: 'ok', result: { id: 5, name: 'user-5' } });
  });
});
