import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { type ParsedArgs } from '../../../core/args';
import { loadReplayKit, runReplay, type ReplayKit } from '../replay';

let project: string;
let output: string[];
const stopped: string[] = [];

beforeEach(async () => {
  project = await mkdtemp(path.join(tmpdir(), 'frontmcp-replay-'));
  await mkdir(path.join(project, 'src'));
  await writeFile(path.join(project, 'src', 'main.ts'), 'export default class Server {}\n');
  jest.spyOn(process, 'cwd').mockReturnValue(project);
  output = [];
  stopped.length = 0;
  jest.spyOn(console, 'log').mockImplementation((line: string) => void output.push(line));
  process.exitCode = undefined;
});

afterEach(async () => {
  jest.restoreAllMocks();
  process.exitCode = undefined;
  await rm(project, { recursive: true, force: true });
});

function fakeKit(differences: unknown[]): { kit: ReplayKit; started: unknown[]; replayed: unknown[] } {
  const started: unknown[] = [];
  const replayed: unknown[] = [];
  const kit: ReplayKit = {
    TestServer: {
      start: async (options) => {
        started.push(options);
        return { info: { baseUrl: 'http://localhost:4100' }, stop: async () => void stopped.push('stopped') };
      },
    },
    replaySession: async (file, server, options) => {
      replayed.push({ file, baseUrl: server.info.baseUrl, options });
      return { file, calls: [], differences };
    },
    formatReplayReport: (report) => `report of ${report.differences.length} differences`,
  };
  return { kit, started, replayed };
}

const args = (extra: Partial<ParsedArgs>): ParsedArgs & { replay: string } => ({
  _: ['test'],
  env: false,
  replay: 'calls.jsonl',
  ...extra,
});

describe('runReplay', () => {
  it('starts the project server through TestServer, replays the file against it and prints the report', async () => {
    const { kit, started, replayed } = fakeKit([]);

    await runReplay(args({ replay: 'calls.jsonl', replayIgnore: ['**.at'] }), kit);

    expect(started).toEqual([
      {
        command: `npx tsx ${JSON.stringify(path.join(project, 'src', 'main.ts'))}`,
        cwd: project,
        port: 0,
        env: expect.any(Object),
      },
    ]);
    expect(replayed).toEqual([
      { file: path.join(project, 'calls.jsonl'), baseUrl: 'http://localhost:4100', options: { ignore: ['**.at'] } },
    ]);
    expect(output.at(-1)).toBe('report of 0 differences');
    expect(process.exitCode).toBeUndefined();
    expect(stopped).toEqual(['stopped']);
  });

  it('starts the entry frontmcp.config names, with the .env loaded', async () => {
    await writeFile(path.join(project, 'src', 'server.ts'), 'export default class Server {}\n');
    await writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'shop' }));
    await writeFile(
      path.join(project, 'frontmcp.config.json'),
      JSON.stringify({ name: 'shop', entry: 'src/server.ts', deployments: [{ target: 'node' }] }),
    );
    const { kit, started } = fakeKit([]);

    await runReplay({ _: ['test'], replay: 'calls.jsonl', config: 'frontmcp.config.json' }, kit);

    expect(started).toEqual([
      expect.objectContaining({ command: `npx tsx ${JSON.stringify(path.join(project, 'src', 'server.ts'))}` }),
    ]);
  });

  it('exits with code 1 when a call differs', async () => {
    const { kit } = fakeKit([{ line: 1 }]);

    await runReplay(args({ replay: 'calls.jsonl' }), kit);

    expect(process.exitCode).toBe(1);
  });

  it('stops the server when the replay fails', async () => {
    const { kit } = fakeKit([]);
    kit.replaySession = async () => {
      throw new Error('calls.jsonl line 2 is not a call record');
    };

    await expect(runReplay(args({ replay: 'calls.jsonl' }), kit)).rejects.toThrow('line 2');
    expect(stopped).toEqual(['stopped']);
  });
});

describe('loadReplayKit', () => {
  it("loads the project's @frontmcp/testing", () => {
    const kit = loadReplayKit(project, () => require.resolve('../../../core/colors'));
    expect(typeof kit).toBe('object');
  });

  it('says how to install @frontmcp/testing when the project lacks it', () => {
    const missing = () => {
      throw new Error('Cannot find module');
    };
    expect(() => loadReplayKit(project, missing)).toThrow('npm install -D @frontmcp/testing');
  });
});
