import * as path from 'path';

import { escapeControlCharacters } from '@frontmcp/utils';

import { resolveConfig } from '../../config';
import { type ParsedArgs } from '../../core/args';
import { c } from '../../core/colors';
import { loadCommandEnv } from '../../shared/env';
import { resolveEntry } from '../../shared/fs';
import { buildTestChildEnv } from './test';

interface ReplayServer {
  info: { baseUrl: string };
  stop(): Promise<void>;
}

interface ReplayReport {
  file: string;
  calls: unknown[];
  differences: unknown[];
}

/** The text of a differing call that the report prints. */
interface ReplayCallText {
  method?: unknown;
  name?: unknown;
  error?: { code?: unknown; message?: unknown };
  changes?: Array<{ path?: unknown }>;
}

/** What `frontmcp test --replay` uses of the project's `@frontmcp/testing`. */
export interface ReplayKit {
  TestServer: {
    start(options: { command: string; cwd: string; port: number; env: NodeJS.ProcessEnv }): Promise<ReplayServer>;
  };
  replaySession(file: string, server: ReplayServer, options: { ignore?: string[] }): Promise<ReplayReport>;
  formatReplayReport(report: ReplayReport): string;
}

type Resolve = (id: string, options: { paths: string[] }) => string;

/** One word of the command line `TestServer` runs through a shell; under `sh` nothing in it expands. */
function shellWord(value: string): string {
  return process.platform === 'win32' ? JSON.stringify(value) : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A string with its line breaks and control characters as visible escapes; any other value as it is. */
function oneLine(value: unknown): unknown {
  return typeof value === 'string' ? escapeControlCharacters(value) : value;
}

/** The report with each name, error and path it prints kept to one line, whatever `@frontmcp/testing` the project has. */
function withOneLineText(report: ReplayReport): ReplayReport {
  const differences = (report.differences as ReplayCallText[]).map((call) => ({
    ...call,
    method: oneLine(call.method),
    name: oneLine(call.name),
    error: call.error && { ...call.error, code: oneLine(call.error.code), message: oneLine(call.error.message) },
    changes: call.changes?.map((change) => ({ ...change, path: oneLine(change.path) })),
  }));
  return { ...report, file: escapeControlCharacters(report.file), differences };
}

/** The project's own `@frontmcp/testing`, so the replay runs the client and test server the project's specs use. */
export function loadReplayKit(cwd: string, resolve: Resolve = require.resolve): ReplayKit {
  let modulePath: string;
  try {
    modulePath = resolve('@frontmcp/testing', { paths: [cwd] });
  } catch {
    throw new Error('frontmcp test --replay needs @frontmcp/testing in this project: npm install -D @frontmcp/testing');
  }
  return require(modulePath) as ReplayKit;
}

/** `frontmcp test --replay`: replays the file against the entry `TestServer` runs with `npx tsx`; exit code 1 on a difference. */
export async function runReplay(opts: ParsedArgs & { replay: string }, kit?: ReplayKit): Promise<void> {
  const cwd = process.cwd();
  if (opts.env !== false) loadCommandEnv(cwd, 'test');
  const resolved = await resolveConfig({
    cwd,
    mode: 'test',
    configPath: typeof opts.config === 'string' ? opts.config : undefined,
  });
  const configEntry = typeof resolved.config?.entry === 'string' ? resolved.config.entry : undefined;
  const entry = await resolveEntry(cwd, configEntry);
  const file = path.resolve(cwd, opts.replay);
  const replayKit = kit ?? loadReplayKit(cwd);

  console.log(`${c('cyan', '[test]')} replaying ${path.relative(cwd, file)} against ${path.relative(cwd, entry)}`);
  const server = await replayKit.TestServer.start({
    command: `npx tsx ${shellWord(entry)}`,
    cwd,
    port: 0,
    env: buildTestChildEnv({ effectiveEnv: resolved.effectiveEnv, baseEnv: process.env }),
  });
  try {
    const report = await replayKit.replaySession(file, server, { ignore: opts.replayIgnore });
    console.log(replayKit.formatReplayReport(withOneLineText(report)));
    if (report.differences.length > 0) process.exitCode = 1;
  } finally {
    await server.stop();
  }
}
