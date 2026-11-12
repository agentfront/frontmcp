/**
 * A CLI-mode server (`createForCli()`) writes its log lines to its log file, and to the console only with
 * `FRONTMCP_CLI_VERBOSE=1`. Without a `logging` option it wrote no line at all: the option was built with no level.
 */
import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { mkdtemp, readdir, readFile, rm } from '@frontmcp/utils';

import { App, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../front-mcp';

@App({ id: 'empty', name: 'Empty' })
class EmptyApp {}

const START_LINE = 'Initializing FrontMCP "cli-logging v1.0.0"';
const ENV_NAMES = ['FRONTMCP_LOG_DIR', 'FRONTMCP_LOG_LEVEL', 'FRONTMCP_LOGS_MAX', 'FRONTMCP_CLI_VERBOSE'] as const;

describe('createForCli logging', () => {
  const savedEnv = ENV_NAMES.map((name) => [name, process.env[name]] as const);
  let logDir: string;
  let consoleInfo: jest.SpyInstance;

  beforeEach(async () => {
    logDir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-cli-logging-'));
    for (const name of ENV_NAMES) delete process.env[name];
    process.env['FRONTMCP_LOG_DIR'] = logDir;
    consoleInfo = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(logDir, { recursive: true, force: true });
  });

  /** Start a CLI-mode server and stop it; returns what its log file holds and what it printed on the console. */
  async function runCliServer(logging: FrontMcpConfigInput['logging']): Promise<{ file: string; console: string }> {
    const instance = await FrontMcpInstance.createForCli({
      info: { name: 'cli-logging', version: '1.0.0' },
      apps: [EmptyApp],
      ...(logging ? { logging } : {}),
    });
    await instance.shutdown();
    const fileNames = await readdir(logDir);
    const files = await Promise.all(fileNames.map((fileName) => readFile(path.join(logDir, fileName))));
    return {
      file: files.join(''),
      console: consoleInfo.mock.calls.map((args) => args.map(String).join(' ')).join('\n'),
    };
  }

  it.each<[string, FrontMcpConfigInput['logging']]>([
    ['no logging option', undefined],
    ['logging: {}', {}],
  ])('writes its log lines to its log file with %s, and none to the console', async (_label, logging) => {
    const written = await runCliServer(logging);

    expect(written.file).toContain(START_LINE);
    expect(written.console).not.toContain(START_LINE);
  });

  it('writes them to the console too with FRONTMCP_CLI_VERBOSE=1 and no logging option', async () => {
    process.env['FRONTMCP_CLI_VERBOSE'] = '1';

    const written = await runCliServer(undefined);

    expect(written.file).toContain(START_LINE);
    expect(written.console).toContain(START_LINE);
  });

  it('takes its level from FRONTMCP_LOG_LEVEL with no logging option', async () => {
    process.env['FRONTMCP_LOG_LEVEL'] = 'error';

    const written = await runCliServer(undefined);

    expect(written.file).not.toContain(START_LINE);
  });
});
