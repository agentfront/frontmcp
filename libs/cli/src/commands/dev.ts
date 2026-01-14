import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn, ChildProcess } from 'child_process';
import { ParsedArgs } from '../args.js';
import { c } from '../colors.js';
import { resolveEntry } from '../utils/fs.js';
import { loadDevEnv } from '../utils/env.js';
import { resolveTuiBinary } from '../dashboard/tui/resolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function killQuiet(proc?: ChildProcess) {
  try {
    if (proc) {
      proc.kill('SIGINT');
    }
  } catch {
    // ignore
  }
}

/**
 * Find the nearest tsconfig.json for the entry file.
 */
function findTsConfig(entryPath: string): string | null {
  let dir = path.dirname(entryPath);
  const root = path.parse(dir).root;

  while (dir !== root) {
    const tsconfig = path.join(dir, 'tsconfig.json');
    try {
      require('fs').accessSync(tsconfig);
      return tsconfig;
    } catch {
      // Not found, go up
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Run dev command in simple mode (no dashboard).
 * This is the original behavior.
 */
async function runDevSimple(entry: string, cwd: string): Promise<void> {
  console.log(`${c('cyan', '[dev]')} using entry: ${path.relative(cwd, entry)}`);

  // Find tsconfig for type checking
  const tsconfig = findTsConfig(entry);
  const hasTypeChecker = !!tsconfig;

  if (hasTypeChecker) {
    console.log(
      `${c('gray', '[dev]')} starting ${c('bold', 'tsx --watch')} and ${c(
        'bold',
        'tsc --noEmit --watch',
      )} (async type-checker)`,
    );
  } else {
    console.log(`${c('gray', '[dev]')} starting ${c('bold', 'tsx --watch')} (no tsconfig found for type-checker)`);
  }
  console.log(`${c('gray', 'hint:')} press Ctrl+C to stop`);

  // Use --conditions node to ensure proper Node.js module resolution
  // This helps with dynamic require() calls in packages like ioredis
  const app = spawn('npx', ['-y', 'tsx', '--conditions', 'node', '--watch', entry], {
    stdio: 'inherit',
    shell: true,
  });

  // Only spawn type checker if we found a tsconfig
  const checker = hasTypeChecker
    ? spawn('npx', ['-y', 'tsc', '--noEmit', '--pretty', '--watch', '--project', tsconfig], {
        stdio: 'inherit',
        shell: true,
      })
    : undefined;

  const cleanup = () => {
    killQuiet(checker);
    killQuiet(app);
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  await new Promise<void>((resolve, reject) => {
    app.on('close', () => {
      cleanup();
      resolve();
    });
    app.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}

/**
 * Run dev command with Rust TUI dashboard.
 * Returns true if successful, false if TUI binary not available.
 */
async function runDevRustTui(entry: string, cwd: string): Promise<boolean> {
  const tuiBinary = resolveTuiBinary();

  if (!tuiBinary) {
    return false;
  }

  console.log(`${c('cyan', '[dev]')} starting Rust TUI dashboard...`);

  // Create a temp file for event communication
  // This avoids piping stdin which breaks crossterm's keyboard input
  const os = await import('os');
  const fs = await import('fs');
  const eventPipePath = path.join(os.tmpdir(), `frontmcp-events-${process.pid}.pipe`);

  // Create the pipe file
  fs.writeFileSync(eventPipePath, '');

  // Get the preload script path
  const preloadPath = path.join(__dirname, '../dashboard/preload/dev-preload.js');

  // Find tsconfig for type checking
  const tsconfig = findTsConfig(entry);

  // Spawn server process with IPC channel
  const server = spawn('npx', ['-y', 'tsx', '--import', preloadPath, '--watch', entry], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    shell: true,
    env: {
      ...process.env,
      FRONTMCP_DEV_MODE: 'true',
    },
  });

  // Spawn type checker only if we can find a tsconfig
  const checker = tsconfig
    ? spawn('npx', ['-y', 'tsc', '--noEmit', '--pretty', '--watch', '--project', tsconfig], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      })
    : undefined;

  // Open the event pipe for writing
  const eventPipeStream = fs.createWriteStream(eventPipePath, { flags: 'a' });

  // Spawn the Rust TUI with stdin inherited (for keyboard input)
  const tui = spawn(tuiBinary, [], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: {
      ...process.env,
      FRONTMCP_ENTRY: path.relative(cwd, entry),
      FRONTMCP_EVENT_PIPE: eventPipePath,
    },
  });

  // Write server stderr to event pipe (events come via stderr)
  if (server.stderr) {
    server.stderr.on('data', (data: Buffer) => {
      eventPipeStream.write(data);
    });
  }

  // Forward IPC messages to event pipe
  server.on('message', (msg) => {
    eventPipeStream.write(JSON.stringify(msg) + '\n');
  });

  const cleanup = () => {
    killQuiet(checker);
    killQuiet(server);
    killQuiet(tui);
    eventPipeStream.end();
    try {
      fs.unlinkSync(eventPipePath);
    } catch {
      // Ignore cleanup errors
    }
  };

  // Handle SIGINT
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  // Handle TUI exit (user pressed 'q')
  tui.on('close', () => {
    cleanup();
  });

  // Handle server exit
  server.on('close', () => {
    cleanup();
  });

  server.on('error', (err) => {
    console.error(`${c('red', '[dev]')} Server error:`, err.message);
    cleanup();
  });

  // Wait for TUI to exit
  await new Promise<void>((resolve) => {
    tui.on('close', resolve);
    server.on('close', resolve);
  });

  cleanup();
  return true;
}

/**
 * Run dev command with Ink dashboard.
 */
async function runDevDashboard(entry: string, cwd: string): Promise<void> {
  // Dynamic import to avoid loading React/Ink when not needed
  const { render } = await import('ink');
  const React = await import('react');
  const { App } = await import('../dashboard/components/App.js');

  // Get the preload script path
  const preloadPath = path.join(__dirname, '../dashboard/preload/dev-preload.js');

  console.log(`${c('cyan', '[dev]')} starting dashboard mode...`);

  // Spawn server process with IPC channel
  const app = spawn('npx', ['-y', 'tsx', '--import', preloadPath, '--watch', entry], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    shell: true,
    env: {
      ...process.env,
      FRONTMCP_DEV_MODE: 'true',
    },
  });

  // Spawn type checker only if we can find a tsconfig
  const tsconfig = findTsConfig(entry);
  const checker = tsconfig
    ? spawn('npx', ['-y', 'tsc', '--noEmit', '--pretty', '--watch', '--project', tsconfig], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      })
    : undefined;

  const cleanup = () => {
    killQuiet(checker);
    killQuiet(app);
  };

  // Handle SIGINT
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  // Render Ink dashboard
  const { waitUntilExit, unmount } = render(
    React.createElement(App, {
      serverProcess: app,
      checkerProcess: checker,
      entryPath: path.relative(cwd, entry),
    }),
    {
      // Don't patch console - we handle stdout/stderr ourselves
      patchConsole: false,
    },
  );

  // Handle app close
  app.on('close', () => {
    cleanup();
    unmount();
  });

  app.on('error', (err) => {
    console.error(`${c('red', '[dev]')} Server error:`, err.message);
    cleanup();
    unmount();
  });

  await waitUntilExit();
  cleanup();
}

export async function runDev(opts: ParsedArgs): Promise<void> {
  const cwd = process.cwd();
  const entry = await resolveEntry(cwd, opts.entry);

  // Load .env and .env.local files before starting the server
  loadDevEnv(cwd);

  // Check if dashboard should be disabled
  if (opts.noDashboard) {
    await runDevSimple(entry, cwd);
    return;
  }

  // Try Rust TUI first (best performance)
  const rustTuiSuccess = await runDevRustTui(entry, cwd);
  if (rustTuiSuccess) {
    return;
  }

  // Fall back to Ink dashboard
  console.log(`${c('gray', '[dev]')} Native TUI not available, using JavaScript dashboard`);

  try {
    await runDevDashboard(entry, cwd);
  } catch (err) {
    // If Ink fails to load (e.g., missing dependency, ESM issues), fall back to simple mode
    const message = err instanceof Error ? err.message : String(err);
    const errorCode = (err as NodeJS.ErrnoException).code;

    const isDashboardError =
      message.includes('Cannot find module') ||
      message.includes('ReactCurrentOwner') ||
      message.includes('react-reconciler') ||
      errorCode === 'ERR_REQUIRE_ASYNC_MODULE' || // Ink 6 is ESM-only
      errorCode === 'ERR_REQUIRE_ESM';

    if (isDashboardError) {
      console.log(`${c('yellow', '[dev]')} Dashboard not available, using simple mode`);
      console.log(`${c('gray', '[dev]')} Reason: ${errorCode || message.slice(0, 80)}`);
      console.log(`${c('gray', '[dev]')} Use --no-dashboard flag to skip this check`);
      await runDevSimple(entry, cwd);
    } else {
      throw err;
    }
  }
}
