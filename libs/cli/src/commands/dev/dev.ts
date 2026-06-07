import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';

import { resolveConfig } from '../../config';
import { type ParsedArgs } from '../../core/args';
import { c } from '../../core/colors';
import { loadDevEnv } from '../../shared/env';
import { resolveEntry } from '../../shared/fs';
import { findNextFreePort, isPortFree, lookupPortOwner } from './port';

const DEFAULT_DEV_PORT = 3000;

function killQuiet(proc?: ChildProcess, signal: NodeJS.Signals = 'SIGINT') {
  try {
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      proc.kill(signal);
    }
  } catch {
    // ignore
  }
}

/**
 * Resolve the port the dev child should bind to and report any conflict
 * clearly. Returns the chosen port — or never returns and exits the process
 * with a clear error when the port is busy and `--auto-port` was not set.
 *
 * Issue #398: previously the child crashed with a raw `EADDRINUSE` stack
 * trace; this helper turns that into a one-line message with a suggested
 * remediation and (optionally) the owning process.
 */
export async function resolveDevPort(opts: {
  port?: number;
  autoPort?: boolean;
  showConflict?: boolean;
  envPort?: string | undefined;
  exit?: (code: number) => never;
  log?: (msg: string) => void;
}): Promise<number> {
  const exit = opts.exit ?? ((code: number) => process.exit(code) as never);
  const log = opts.log ?? ((msg: string) => console.error(msg));
  const explicit = opts.port ?? (opts.envPort !== undefined && opts.envPort !== '' ? Number(opts.envPort) : undefined);
  const port =
    explicit !== undefined && Number.isFinite(explicit) && (explicit as number) > 0
      ? (explicit as number)
      : DEFAULT_DEV_PORT;

  if (await isPortFree(port)) return port;

  if (opts.autoPort) {
    const alt = await findNextFreePort(port + 1);
    log(`${c('yellow', '[dev]')} port ${port} is in use; auto-picked ${alt}`);
    return alt;
  }

  // Build a clear, actionable error message.
  const lines = [
    `${c('red', '[dev]')} Port ${port} is already in use — refusing to start.`,
    `${c('gray', '      ')} Retry with one of:`,
    `${c('gray', '        ')} • ${c('bold', `frontmcp dev --port <other-port>`)}`,
    `${c('gray', '        ')} • ${c('bold', `frontmcp dev --auto-port`)}     ${c('gray', '(pick the next free port automatically)')}`,
    `${c('gray', '        ')} • ${c('bold', `PORT=<other-port> frontmcp dev`)}`,
  ];
  if (opts.showConflict) {
    const owner = await lookupPortOwner(port);
    if (owner) {
      lines.push(`${c('gray', '      ')} Holder of ${port}:`);
      for (const row of owner.split('\n')) lines.push(`${c('gray', '        ')} ${row}`);
    } else {
      lines.push(`${c('gray', '      ')} (could not identify the holder of port ${port})`);
    }
  } else {
    lines.push(`${c('gray', '      ')} (pass --show-conflict to print which process is holding the port)`);
  }
  for (const line of lines) log(line);
  return exit(1);
}

/**
 * Build the environment handed to the spawned dev child.
 *
 * The resolved port is exported as `PORT`, and the configured
 * `transport.http.path` (when set) as `FRONTMCP_HTTP_ENTRY_PATH` so the server
 * mounts the MCP endpoint where the generated client URLs point (#446). Both are
 * applied AFTER the inherited env so the dev-resolved values win for this run —
 * the same precedence as `PORT`. A hard-coded `@FrontMcp({ http: { entryPath } })`
 * in metadata still wins over the env (the SDK only reads it as a default).
 */
export function buildDevChildEnv(params: {
  effectiveEnv: NodeJS.ProcessEnv;
  baseEnv: NodeJS.ProcessEnv;
  port: number;
  configHttpPath?: string;
}): NodeJS.ProcessEnv {
  const { effectiveEnv, baseEnv, port, configHttpPath } = params;
  return {
    ...effectiveEnv,
    ...baseEnv,
    PORT: String(port),
    ...(configHttpPath !== undefined ? { FRONTMCP_HTTP_ENTRY_PATH: configHttpPath } : {}),
  };
}

export async function runDev(opts: ParsedArgs): Promise<void> {
  // Issue #399 — `--stdio` runs the first-party watch-aware stdio bridge
  // instead of the legacy `tsx --watch + tsc --noEmit --watch` pair. The
  // bridge owns process stdin/stdout (JSON-RPC frames only), holds the
  // upstream MCP session across child restarts, and replaces the
  // third-party `mcp-remote` recipe for the dev loop.
  if (opts.stdio) {
    const { runDevBridge } = await import('./bridge/index.js');
    return runDevBridge(opts);
  }

  const cwd = process.cwd();

  // Issue #400 — resolve frontmcp.config so `entry`, `transport.http.port`,
  // and `env.shared`/`env.dev` overlays apply. Precedence:
  //   CLI flag > FRONTMCP_<NAME> env > frontmcp.config field > built-in default.
  const resolved = await resolveConfig({
    cwd,
    mode: 'dev',
    configPath: typeof opts.config === 'string' ? opts.config : undefined,
  });
  const cfg = resolved.config;

  const cliEntry = typeof opts.entry === 'string' ? opts.entry : undefined;
  const configEntry = typeof cfg?.entry === 'string' ? cfg.entry : undefined;
  const entry = await resolveEntry(cwd, cliEntry ?? configEntry);

  // Load .env and .env.local files (these win over config env overlays for
  // parity with existing behavior — file-based env is the deployment escape
  // hatch and shouldn't be silently overridden by committed config).
  loadDevEnv(cwd);

  // Resolve the port BEFORE spawning tsx so EADDRINUSE produces a clean
  // one-line error instead of a raw node:net stack trace (issue #398).
  //
  // Two caveats worth knowing about this pre-flight check:
  //   1. TOCTOU — between this probe returning and the child actually binding,
  //      another process can grab the port. We accept that race: this is a
  //      dev-time tool, the worst case reverts to the prior behaviour (the
  //      child surfaces a raw EADDRINUSE), and the common case (port already
  //      busy at startup) is the one we wanted to fix.
  //   2. The resolved port is exported as `PORT` to the child. It only takes
  //      effect when the user's `@FrontMcp({ http: { port } })` reads
  //      `process.env.PORT` (the SDK's `httpOptionsSchema` default does).
  //      If the user's metadata HARD-CODES `http.port`, the child binds to
  //      that hard-coded value and ignores PORT — the probe is then advisory
  //      only. Documented in docs/frontmcp/deployment/local-dev-server.mdx.
  const cliPort = typeof opts.port === 'number' ? opts.port : opts.port ? Number(opts.port) : undefined;
  const configPort = cfg?.transport?.http?.port;
  const port = await resolveDevPort({
    port: cliPort ?? configPort,
    autoPort: !!opts.autoPort,
    showConflict: !!opts.showConflict,
    envPort: process.env['PORT'],
  });

  // Issue #446 — honor the configured MCP mount path in dev. `transport.http.path`
  // already drives the generated client URLs (eject); propagate it to the spawned
  // server via FRONTMCP_HTTP_ENTRY_PATH so the endpoint is actually mounted there
  // (the SDK's httpOptionsSchema.entryPath default reads this env). Same precedence
  // caveat as PORT: a hard-coded `@FrontMcp({ http: { entryPath } })` still wins.
  const configHttpPath = typeof cfg?.transport?.http?.path === 'string' ? cfg.transport.http.path : undefined;

  console.log(`${c('cyan', '[dev]')} using entry: ${path.relative(cwd, entry)}`);
  if (resolved.configPath || resolved.configDir) {
    console.log(`${c('gray', '[dev]')} config: ${resolved.configPath ?? resolved.configDir}`);
  }
  console.log(`${c('cyan', '[dev]')} listening on port: ${port}`);
  if (configHttpPath) {
    console.log(`${c('gray', '[dev]')} MCP endpoint path: ${configHttpPath}`);
  }
  console.log(
    `${c('gray', '[dev]')} starting ${c('bold', 'tsx --watch')} and ${c(
      'bold',
      'tsc --noEmit --watch',
    )} (async type-checker)`,
  );
  console.log(`${c('gray', 'hint:')} press Ctrl+C to stop`);

  // Use --conditions node to ensure proper Node.js module resolution.
  // This helps with dynamic require() calls in packages like ioredis.
  // On Windows resolve npx.cmd directly — previously we passed shell:true
  // for the .cmd suffix, but that triggers Node DEP0190 (#381) every run.
  // spawn() resolves .cmd via CreateProcessW since Node 16, so no shell is
  // needed; on Unix spawn() works on 'npx' directly. SIGINT still
  // propagates cleanly because no intermediate shell sits between us and
  // the child process.
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  // Issue #400 — env overlays from `frontmcp.config.env.{shared,dev}` are
  // included via `resolved.effectiveEnv`. `.env`/`.env.local` already loaded
  // into `process.env` above, so they win (they're closer to deployment).
  const childEnv = buildDevChildEnv({
    effectiveEnv: resolved.effectiveEnv,
    baseEnv: process.env,
    port,
    configHttpPath,
  });
  const app = spawn(npxCmd, ['-y', 'tsx', '--conditions', 'node', '--watch', entry], {
    stdio: 'inherit',
    env: childEnv,
  });
  const checker = spawn(npxCmd, ['-y', 'tsc', '--noEmit', '--pretty', '--watch'], {
    stdio: 'inherit',
    env: childEnv,
  });

  const cleanup = (clearTimer = true) => {
    if (clearTimer) {
      clearForceKillTimer();
    }
    killQuiet(checker);
    killQuiet(app);
  };

  let forceKillTimer: NodeJS.Timeout | undefined;
  let appClosed = false;
  let checkerClosed = false;

  const clearForceKillTimer = () => {
    if (forceKillTimer) {
      clearTimeout(forceKillTimer);
      forceKillTimer = undefined;
    }
  };

  const markClosed = (child: 'app' | 'checker') => {
    if (child === 'app') {
      appClosed = true;
    } else {
      checkerClosed = true;
    }
    if (appClosed && checkerClosed) {
      clearForceKillTimer();
    }
  };

  process.once('SIGINT', () => {
    cleanup(false);
    // Force-kill after 2s if children haven't exited
    clearForceKillTimer();
    forceKillTimer = setTimeout(() => {
      killQuiet(checker, 'SIGKILL');
      killQuiet(app, 'SIGKILL');
      process.exit(0);
    }, 2000);
    forceKillTimer.unref();
    // Exit cleanly once both children have closed
    const tryExit = () => {
      if (appClosed && checkerClosed) {
        clearForceKillTimer();
        process.exit(0);
      }
    };
    app.once('close', () => {
      markClosed('app');
      tryExit();
    });
    checker.once('close', () => {
      markClosed('checker');
      tryExit();
    });
  });

  process.once('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  let appExitCode: number | null = 0;
  await new Promise<void>((resolve, reject) => {
    app.on('close', (code) => {
      // Capture the child's exit code so it can propagate to the parent
      // shell. SIGINT/SIGTERM yield code=null with a signalCode — treat
      // those as 0 so Ctrl+C doesn't appear as a failure.
      appExitCode = typeof code === 'number' ? code : 0;
      markClosed('app');
      cleanup(false);
      resolve();
    });
    app.on('error', (err) => {
      clearForceKillTimer();
      cleanup();
      reject(err);
    });
    checker.on('close', () => {
      markClosed('checker');
    });
    checker.on('error', (err) => {
      clearForceKillTimer();
      cleanup();
      reject(err);
    });
  });

  // Propagate the child's exit code so CI / shells see real failures
  // instead of always-success.
  if (appExitCode && appExitCode !== 0) {
    process.exit(appExitCode);
  }
}
