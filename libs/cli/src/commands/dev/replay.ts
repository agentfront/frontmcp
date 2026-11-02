import * as path from 'path';

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

/** What `frontmcp test --replay` uses of the project's `@frontmcp/testing`. */
export interface ReplayKit {
  TestServer: {
    start(options: { command: string; cwd: string; port: number; env: NodeJS.ProcessEnv }): Promise<ReplayServer>;
  };
  replaySession(file: string, server: ReplayServer, options: { ignore?: string[] }): Promise<ReplayReport>;
  formatReplayReport(report: ReplayReport): string;
}

type Resolve = (id: string, options: { paths: string[] }) => string;

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
    command: `npx tsx ${JSON.stringify(entry)}`,
    cwd,
    port: 0,
    env: buildTestChildEnv({ effectiveEnv: resolved.effectiveEnv, baseEnv: process.env }),
  });
  try {
    const report = await replayKit.replaySession(file, server, { ignore: opts.replayIgnore });
    console.log(replayKit.formatReplayReport(report));
    if (report.differences.length > 0) process.exitCode = 1;
  } finally {
    await server.stop();
  }
}
