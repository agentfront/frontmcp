import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';

import { resolveConfig, type ResolvedFrontMcpConfig } from '../../config';
import { absolutizePathOptions, enterConfigRoot } from '../../config/project-root';
import { pickServerDefaults, securityHeadersEnv } from '../../config/security-headers-env';
import { type ParsedArgs } from '../../core/args';
import { c } from '../../core/colors';
import { loadDevEnv } from '../../shared/env';
import { resolveEntry } from '../../shared/fs';
import { processTreeSpawnOptions, signalProcessTree, stopProcessTree } from '../../shared/process-tree';
import { findNextFreePort, isPortFree, lookupPortOwner } from './port';

const DEFAULT_DEV_PORT = 3000;

/** How long children get to exit after a shutdown signal before `SIGKILL`. */
const SHUTDOWN_GRACE_MS = 2000;

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
  securityHeadersEnv?: Record<string, string>;
}): NodeJS.ProcessEnv {
  const { effectiveEnv, baseEnv, port, configHttpPath, securityHeadersEnv } = params;
  return {
    ...securityHeadersEnv,
    ...effectiveEnv,
    ...baseEnv,
    PORT: String(port),
    ...(configHttpPath !== undefined ? { FRONTMCP_HTTP_ENTRY_PATH: configHttpPath } : {}),
  };
}

/**
 * Everything `frontmcp dev` (HTTP or `--stdio`) needs before it spawns the
 * server: project root, entry, port and the child env.
 */
export interface DevLaunch {
  /** Directory the command runs from — the folder holding a `frontmcp.config.*` found above the cwd. */
  cwd: string;
  /** Set when the command moved to the config's folder (#679). */
  movedFrom?: string;
  entry: string;
  port: number;
  /** `transport.http.path`, exported to the child as `FRONTMCP_HTTP_ENTRY_PATH`. */
  configHttpPath?: string;
  childEnv: NodeJS.ProcessEnv;
  resolved: ResolvedFrontMcpConfig;
}

export interface ResolveDevLaunchOptions {
  /**
   * Pick a free port when none was chosen (no `--port`, `transport.http.port`
   * or `PORT`). The stdio bridge sets this: its loopback port is internal, so a
   * busy default must not stop it from starting.
   */
  autoPortWhenUnset?: boolean;
  /**
   * `false` when nothing will listen on the port (`--stdio --serve`): skip the
   * busy-port check instead of refusing to start over a port nobody uses.
   */
  listens?: boolean;
  /** Where port notices go (`--stdio` keeps stdout for JSON-RPC). */
  log?: (msg: string) => void;
}

/**
 * Resolve config, project root, entry, port and child env for `frontmcp dev`.
 *
 * Issue #400 — precedence is CLI flag > frontmcp.config field > built-in
 * default; `env.shared`/`env.dev` overlays apply. Issue #679 — a config found
 * above the cwd makes its folder the project root (see `enterConfigRoot`).
 */
export async function resolveDevLaunch(opts: ParsedArgs, options: ResolveDevLaunchOptions = {}): Promise<DevLaunch> {
  const invocationCwd = process.cwd();
  const resolved = await resolveConfig({
    cwd: invocationCwd,
    mode: 'dev',
    configPath: typeof opts.config === 'string' ? opts.config : undefined,
  });
  const cwd = enterConfigRoot(resolved, invocationCwd);
  // Paths typed on the command line keep meaning what the user typed.
  const args = cwd === invocationCwd ? opts : absolutizePathOptions(opts, ['entry'], invocationCwd);
  const cfg = resolved.config;

  const cliEntry = typeof args.entry === 'string' ? args.entry : undefined;
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
  const cliPort = typeof args.port === 'number' ? args.port : args.port ? Number(args.port) : undefined;
  const configPort = cfg?.transport?.http?.port;
  const envPort = process.env['PORT'];
  const portChosen = cliPort !== undefined || configPort !== undefined || (envPort !== undefined && envPort !== '');
  const port =
    options.listens === false
      ? (cliPort ?? configPort ?? (Number(envPort) || DEFAULT_DEV_PORT))
      : await resolveDevPort({
          port: cliPort ?? configPort,
          autoPort: !!args.autoPort || (!!options.autoPortWhenUnset && !portChosen),
          showConflict: !!args.showConflict,
          envPort,
          log: options.log,
        });

  // Issue #446 — honor the configured MCP mount path in dev. `transport.http.path`
  // already drives the generated client URLs (eject); propagate it to the spawned
  // server via FRONTMCP_HTTP_ENTRY_PATH so the endpoint is actually mounted there
  // (the SDK's httpOptionsSchema.entryPath default reads this env). Same precedence
  // caveat as PORT: a hard-coded `@FrontMcp({ http: { entryPath } })` still wins.
  const configHttpPath = typeof cfg?.transport?.http?.path === 'string' ? cfg.transport.http.path : undefined;

  // Issue #400 — env overlays from `frontmcp.config.env.{shared,dev}` are
  // included via `resolved.effectiveEnv`. `.env`/`.env.local` already loaded
  // into `process.env` above, so they win (they're closer to deployment).
  const childEnv = buildDevChildEnv({
    effectiveEnv: resolved.effectiveEnv,
    baseEnv: process.env,
    port,
    configHttpPath,
    securityHeadersEnv: securityHeadersEnv(pickServerDefaults(cfg)),
  });

  return {
    cwd,
    ...(cwd === invocationCwd ? {} : { movedFrom: invocationCwd }),
    entry,
    port,
    configHttpPath,
    childEnv,
    resolved,
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

  const { cwd, movedFrom, entry, port, configHttpPath, childEnv, resolved } = await resolveDevLaunch(opts);

  if (movedFrom) {
    console.log(`${c('gray', '[dev]')} project root: ${cwd} (frontmcp.config found above ${movedFrom})`);
  }
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
  // needed; on Unix spawn() works on 'npx' directly.
  //
  // #679 — each child leads its own process group (POSIX) so a shutdown
  // signal reaches the server tsx forks, not just npm. Children outside the
  // terminal's foreground group must not read the TTY, so the app's stdin is
  // fed from ours (tsx --watch reruns on Return).
  const treeOptions = processTreeSpawnOptions();
  const app = spawn(npxCmd(), ['-y', 'tsx', '--conditions', 'node', '--watch', entry], {
    stdio: [treeOptions.detached ? 'pipe' : 'inherit', 'inherit', 'inherit'],
    env: childEnv,
    ...treeOptions,
  });
  forwardStdin(app);
  const checker = spawn(npxCmd(), ['-y', 'tsc', '--noEmit', '--pretty', '--watch'], {
    stdio: [treeOptions.detached ? 'ignore' : 'inherit', 'inherit', 'inherit'],
    env: childEnv,
    ...treeOptions,
  });

  // #679 — `kill <pid>` (SIGTERM or SIGINT to this process alone) used to exit
  // 0 straight away while the server kept listening. Every shutdown path now
  // signals both process trees and waits until they are gone.
  let stopping: Promise<void> | undefined;
  const stopChildren = (signal: NodeJS.Signals): Promise<void> => {
    stopping ??= Promise.all([
      stopProcessTree(checker, signal, SHUTDOWN_GRACE_MS),
      stopProcessTree(app, signal, SHUTDOWN_GRACE_MS),
    ]).then(() => undefined);
    return stopping;
  };
  const onSignal = (signal: NodeJS.Signals) => {
    if (stopping) {
      // Second signal while stopping: stop waiting.
      signalProcessTree(checker, 'SIGKILL');
      signalProcessTree(app, 'SIGKILL');
      process.exit(0);
    }
    void stopChildren(signal).then(() => process.exit(0));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let appExitCode: number | null = 0;
  await new Promise<void>((resolve, reject) => {
    app.on('close', (code) => {
      // Capture the child's exit code so it can propagate to the parent
      // shell. SIGINT/SIGTERM yield code=null with a signalCode — treat
      // those as 0 so Ctrl+C doesn't appear as a failure.
      appExitCode = typeof code === 'number' ? code : 0;
      void stopChildren('SIGINT').then(resolve, resolve);
    });
    app.on('error', (err) => {
      void stopChildren('SIGINT').then(() => reject(err));
    });
    checker.on('error', (err) => {
      void stopChildren('SIGINT').then(() => reject(err));
    });
  });

  // Propagate the child's exit code so CI / shells see real failures
  // instead of always-success.
  if (appExitCode && appExitCode !== 0) {
    process.exit(appExitCode);
  }
}

function npxCmd(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

/** Feed our stdin to a child spawned with a piped stdin. */
function forwardStdin(child: ChildProcess): void {
  const target = child.stdin;
  if (!target) return;
  // The child closing its end (it exited) must not crash us with EPIPE.
  target.on('error', () => undefined);
  process.stdin.on('error', () => undefined);
  process.stdin.pipe(target);
}
