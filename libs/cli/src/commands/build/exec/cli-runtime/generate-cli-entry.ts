/**
 * Generates the CLI entry point TypeScript/JavaScript source code.
 * This creates a commander.js-based CLI where each MCP tool is a subcommand.
 */

import { CliConfig } from '../config';
import { ExtractedSchema, ExtractedTool, ExtractedPrompt } from './schema-extractor';
import { schemaToCommander, generateOptionCode, camelToKebab } from './schema-to-commander';

export interface CliEntryOptions {
  appName: string;
  appVersion: string;
  description: string;
  serverBundleFilename: string;
  outputDefault: 'text' | 'json';
  authRequired: boolean;
  excludeTools: string[];
  nativeDeps: NonNullable<CliConfig['nativeDeps']>;
  schema: ExtractedSchema;
}

/**
 * Generate the CLI entry source code (CJS module).
 */
export function generateCliEntry(options: CliEntryOptions): string {
  const {
    appName,
    appVersion,
    description,
    serverBundleFilename,
    outputDefault,
    schema,
    excludeTools,
  } = options;

  const filteredTools = schema.tools.filter(
    (t) => !excludeTools.includes(t.name),
  );

  const sections: string[] = [
    generateHeader(appName, appVersion, description, serverBundleFilename, outputDefault),
    generateToolCommands(filteredTools),
    generateResourceCommands(schema),
    generatePromptCommands(schema.prompts),
    generateSessionCommands(),
    generateServeCommand(serverBundleFilename),
    generateDoctorCommand(appName, options.nativeDeps),
    generateInstallCommand(appName, options.nativeDeps),
    generateDaemonCommands(appName, serverBundleFilename),
    generateFooter(),
  ];

  return sections.join('\n\n');
}

function generateHeader(
  appName: string,
  appVersion: string,
  description: string,
  serverBundleFilename: string,
  outputDefault: string,
): string {
  return `#!/usr/bin/env node
'use strict';

var { Command } = require('commander');
var path = require('path');
var fmt = require('./output-formatter');
var sessions = require('./session-manager');
var creds = require('./credential-store');

var SCRIPT_DIR = __dirname;
var SERVER_BUNDLE = path.join(SCRIPT_DIR, ${JSON.stringify(serverBundleFilename)});

var _client = null;
async function getClient() {
  if (_client) return _client;
  var mod = require(SERVER_BUNDLE);
  var configOrClass = mod.default || mod;
  var sdk = require('@frontmcp/sdk');
  var connect = sdk.connect || sdk.direct.connect;
  _client = await connect(configOrClass);
  return _client;
}

var program = new Command();
program
  .name(${JSON.stringify(appName)})
  .version(${JSON.stringify(appVersion)})
  .description(${JSON.stringify(description || `${appName} CLI`)})
  .option('--output <mode>', 'Output format: text or json', ${JSON.stringify(outputDefault)});`;
}

function generateToolCommands(tools: ExtractedTool[]): string {
  if (tools.length === 0) return '// No tools extracted';

  const commands = tools.map((tool) => {
    const cmdName = camelToKebab(tool.name).replace(/_/g, '-');
    const { options } = schemaToCommander(tool.inputSchema);
    const optionLines = options.map((o) => `  ${generateOptionCode(o)}`).join('\n');

    return `program
  .command(${JSON.stringify(cmdName)})
  .description(${JSON.stringify(tool.description)})
${optionLines}
  .action(async function(opts) {
    try {
      var client = await getClient();
      var args = {};
      var rawOpts = this.opts();
      ${generateArgMapping(tool)}
      var result = await client.callTool(${JSON.stringify(tool.name)}, args);
      var mode = program.opts().output || ${JSON.stringify('text')};
      console.log(fmt.formatToolResult(result, mode));
    } catch (err) {
      console.error('Error:', err.message || err);
      process.exitCode = 1;
    }
  });`;
  });

  return commands.join('\n\n');
}

function generateArgMapping(tool: ExtractedTool): string {
  const props = (tool.inputSchema as Record<string, unknown>).properties as Record<string, unknown> | undefined;
  if (!props) return '';

  const mappings = Object.keys(props).map((propName) => {
    const kebab = camelToKebab(propName);
    // Commander converts kebab-case flags to camelCase in opts()
    const camel = kebabToCamel(kebab);
    return `if (rawOpts[${JSON.stringify(camel)}] !== undefined) args[${JSON.stringify(propName)}] = rawOpts[${JSON.stringify(camel)}];`;
  });

  return mappings.join('\n      ');
}

function generateResourceCommands(schema: ExtractedSchema): string {
  return `var resourceCmd = program.command('resource').description('Resource operations');

resourceCmd
  .command('list')
  .description('List available resources')
  .action(async function() {
    try {
      var client = await getClient();
      var result = await client.listResources();
      var mode = program.opts().output || 'text';
      if (mode === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        var resources = result.resources || [];
        if (resources.length === 0) { console.log('No resources available.'); return; }
        resources.forEach(function(r) {
          console.log('  ' + r.uri + (r.description ? ' - ' + r.description : ''));
        });
      }
    } catch (err) {
      console.error('Error:', err.message || err);
      process.exitCode = 1;
    }
  });

resourceCmd
  .command('read <uri>')
  .description('Read a resource by URI')
  .action(async function(uri) {
    try {
      var client = await getClient();
      var result = await client.readResource(uri);
      var mode = program.opts().output || 'text';
      console.log(fmt.formatResourceResult(result, mode));
    } catch (err) {
      console.error('Error:', err.message || err);
      process.exitCode = 1;
    }
  });`;
}

function generatePromptCommands(prompts: ExtractedPrompt[]): string {
  const subcommands = prompts.map((prompt) => {
    const cmdName = camelToKebab(prompt.name).replace(/_/g, '-');
    const argOptions = (prompt.arguments || [])
      .map((a) => {
        const flag = `--${camelToKebab(a.name)} <value>`;
        const desc = a.description || '';
        return a.required
          ? `  .requiredOption('${flag}', '${escapeStr(desc)}')`
          : `  .option('${flag}', '${escapeStr(desc)}')`;
      })
      .join('\n');

    return `promptCmd
  .command(${JSON.stringify(cmdName)})
  .description(${JSON.stringify(prompt.description || '')})
${argOptions}
  .action(async function(opts) {
    try {
      var client = await getClient();
      var args = {};
      var rawOpts = this.opts();
      ${(prompt.arguments || []).map((a) => {
        const camel = kebabToCamel(camelToKebab(a.name));
        return `if (rawOpts[${JSON.stringify(camel)}] !== undefined) args[${JSON.stringify(a.name)}] = rawOpts[${JSON.stringify(camel)}];`;
      }).join('\n      ')}
      var result = await client.getPrompt(${JSON.stringify(prompt.name)}, args);
      var mode = program.opts().output || 'text';
      console.log(fmt.formatPromptResult(result, mode));
    } catch (err) {
      console.error('Error:', err.message || err);
      process.exitCode = 1;
    }
  });`;
  });

  return `var promptCmd = program.command('prompt').description('Prompt operations');

promptCmd
  .command('list')
  .description('List available prompts')
  .action(async function() {
    try {
      var client = await getClient();
      var result = await client.listPrompts();
      var mode = program.opts().output || 'text';
      if (mode === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        var prompts = result.prompts || [];
        if (prompts.length === 0) { console.log('No prompts available.'); return; }
        prompts.forEach(function(p) {
          console.log('  ' + p.name + (p.description ? ' - ' + p.description : ''));
        });
      }
    } catch (err) {
      console.error('Error:', err.message || err);
      process.exitCode = 1;
    }
  });

${subcommands.join('\n\n')}`;
}

function generateSessionCommands(): string {
  return `var sessionsCmd = program.command('sessions').description('Session management');

sessionsCmd
  .command('list')
  .description('List all sessions')
  .action(function() {
    var list = sessions.listSessions();
    if (list.length === 0) { console.log('No sessions.'); return; }
    list.forEach(function(s) {
      var marker = s.isActive ? ' (active)' : '';
      console.log('  ' + s.name + marker + ' - last used: ' + s.lastUsedAt);
    });
  });

sessionsCmd
  .command('switch <name>')
  .description('Switch to a named session')
  .action(function(name) {
    sessions.switchSession(name);
    console.log('Switched to session: ' + name);
  });

sessionsCmd
  .command('delete <name>')
  .description('Delete a session')
  .action(async function(name) {
    var store = creds.createCredentialStore();
    await store.delete(name);
    sessions.deleteSession(name);
    console.log('Deleted session: ' + name);
  });

program
  .command('connect')
  .description('Authenticate and store credentials')
  .option('--session <name>', 'Session name', 'default')
  .option('--token <token>', 'Auth token (or pass via stdin)')
  .action(async function(opts) {
    var sessionName = opts.session || 'default';
    var token = opts.token;
    if (!token) {
      console.log('Usage: ' + program.name() + ' connect --token <your-token>');
      console.log('  Or pipe token: echo "tok_xxx" | ' + program.name() + ' connect');
      process.exitCode = 1;
      return;
    }
    var store = creds.createCredentialStore();
    await store.set(sessionName, { token: token });
    sessions.getOrCreateSession(sessionName);
    console.log('Credentials stored for session: ' + sessionName);
  });`;
}

function generateServeCommand(serverBundleFilename: string): string {
  return `program
  .command('serve')
  .description('Start the HTTP/SSE server')
  .option('-p, --port <port>', 'Port number', function(v) { return parseInt(v, 10); })
  .action(async function(opts) {
    var mod = require(path.join(SCRIPT_DIR, ${JSON.stringify(serverBundleFilename)}));
    if (opts.port) process.env.PORT = String(opts.port);
    // The server bundle should self-start when required
    if (typeof mod.start === 'function') await mod.start();
    else if (typeof mod.default?.start === 'function') await mod.default.start();
  });`;
}

function generateDoctorCommand(
  appName: string,
  nativeDeps: NonNullable<CliConfig['nativeDeps']>,
): string {
  const checks: string[] = [];

  if (nativeDeps.brew?.length) {
    for (const pkg of nativeDeps.brew) {
      checks.push(`  { name: ${JSON.stringify(pkg)}, type: 'brew', check: 'brew list ${pkg}' }`);
    }
  }
  if (nativeDeps.apt?.length) {
    for (const pkg of nativeDeps.apt) {
      checks.push(`  { name: ${JSON.stringify(pkg)}, type: 'apt', check: 'dpkg -l ${pkg}' }`);
    }
  }
  if (nativeDeps.npm?.length) {
    for (const pkg of nativeDeps.npm) {
      checks.push(`  { name: ${JSON.stringify(pkg)}, type: 'npm', check: 'npm ls ${pkg}' }`);
    }
  }

  return `program
  .command('doctor')
  .description('Check system dependencies and configuration')
  .option('--fix', 'Attempt to install missing dependencies')
  .action(async function(opts) {
    var exec = require('child_process').execSync;
    var ok = true;

    // Check Node.js version
    var nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
    if (nodeMajor >= 22) {
      console.log('  [ok] Node.js v' + process.versions.node);
    } else {
      console.log('  [!!] Node.js v' + process.versions.node + ' (>=22 required)');
      ok = false;
    }

    var deps = [
${checks.join(',\n')}
    ];

    for (var i = 0; i < deps.length; i++) {
      var dep = deps[i];
      try {
        exec(dep.check, { stdio: 'ignore' });
        console.log('  [ok] ' + dep.name + ' (' + dep.type + ')');
      } catch (_) {
        console.log('  [!!] ' + dep.name + ' (' + dep.type + ') - not found');
        ok = false;
        if (opts.fix) {
          try {
            var installCmd = dep.type === 'brew' ? 'brew install ' + dep.name
              : dep.type === 'apt' ? 'sudo apt-get install -y ' + dep.name
              : 'npm install ' + dep.name;
            console.log('      Installing: ' + installCmd);
            exec(installCmd, { stdio: 'inherit' });
            console.log('      [ok] Installed ' + dep.name);
          } catch (e) {
            console.log('      [!!] Failed to install ' + dep.name);
          }
        }
      }
    }

    // Check ~/.frontmcp directory
    var fs = require('fs');
    var appDir = require('path').join(require('os').homedir(), '.frontmcp', 'apps', ${JSON.stringify(appName)});
    if (fs.existsSync(appDir)) {
      console.log('  [ok] App directory: ' + appDir);
    } else {
      console.log('  [!!] App directory not found: ' + appDir);
      ok = false;
    }

    if (ok) console.log('\\nAll checks passed.');
    else {
      console.log('\\nSome checks failed.' + (opts.fix ? '' : ' Run with --fix to attempt repairs.'));
      process.exitCode = 1;
    }
  });`;
}

function generateInstallCommand(
  appName: string,
  nativeDeps: NonNullable<CliConfig['nativeDeps']>,
): string {
  const depEntries: string[] = [];
  if (nativeDeps.brew?.length) {
    for (const pkg of nativeDeps.brew) {
      depEntries.push(`  { name: ${JSON.stringify(pkg)}, type: 'brew', install: 'brew install ${pkg}', check: 'brew list ${pkg}' }`);
    }
  }
  if (nativeDeps.npm?.length) {
    for (const pkg of nativeDeps.npm) {
      depEntries.push(`  { name: ${JSON.stringify(pkg)}, type: 'npm', install: 'npm install ${pkg}', check: 'npm ls ${pkg}' }`);
    }
  }

  return `program
  .command('install')
  .description('Install to ~/.frontmcp/ and set up dependencies')
  .action(async function() {
    var fs = require('fs');
    var pathMod = require('path');
    var os = require('os');
    var exec = require('child_process').execSync;
    var appDir = pathMod.join(os.homedir(), '.frontmcp', 'apps', ${JSON.stringify(appName)});
    var dirs = ['', '/data', '/sessions', '/credentials'].map(function(s) { return appDir + s; });

    console.log('Installing ${appName}...');
    dirs.forEach(function(d) { fs.mkdirSync(d, { recursive: true }); });

    // Copy bundle files
    var files = fs.readdirSync(SCRIPT_DIR).filter(function(f) { return f.endsWith('.js') || f.endsWith('.json'); });
    files.forEach(function(f) {
      fs.copyFileSync(pathMod.join(SCRIPT_DIR, f), pathMod.join(appDir, f));
    });
    console.log('  Copied ' + files.length + ' files to ' + appDir);

    // Install native deps
    var deps = [
${depEntries.join(',\n')}
    ];
    for (var i = 0; i < deps.length; i++) {
      var dep = deps[i];
      try { exec(dep.check, { stdio: 'ignore' }); }
      catch (_) {
        console.log('  [' + (i + 1) + '/' + deps.length + '] Installing ' + dep.name + ' via ' + dep.type + '...');
        try { exec(dep.install, { stdio: 'inherit' }); }
        catch (e) { console.log('  Warning: Failed to install ' + dep.name); }
      }
    }

    // Create symlink
    var binDirs = ['/usr/local/bin', pathMod.join(os.homedir(), '.local', 'bin')];
    var linked = false;
    for (var j = 0; j < binDirs.length && !linked; j++) {
      try {
        fs.mkdirSync(binDirs[j], { recursive: true });
        var linkPath = pathMod.join(binDirs[j], ${JSON.stringify(appName)});
        try { fs.unlinkSync(linkPath); } catch (_) { /* ok */ }
        fs.symlinkSync(pathMod.join(appDir, '${appName}-cli.bundle.js'), linkPath);
        console.log('  Symlinked: ' + linkPath);
        linked = true;
      } catch (_) { /* try next */ }
    }

    console.log('\\nInstalled. Run: ${appName} --help');
  });

program
  .command('uninstall')
  .description('Remove from ~/.frontmcp/ and clean up')
  .action(async function() {
    var fs = require('fs');
    var pathMod = require('path');
    var os = require('os');
    var appDir = pathMod.join(os.homedir(), '.frontmcp', 'apps', ${JSON.stringify(appName)});

    // Remove credentials
    var store = creds.createCredentialStore();
    var credSessions = await store.list();
    for (var i = 0; i < credSessions.length; i++) {
      await store.delete(credSessions[i]);
    }

    // Remove symlink
    var binDirs = ['/usr/local/bin', pathMod.join(os.homedir(), '.local', 'bin')];
    binDirs.forEach(function(d) {
      try { fs.unlinkSync(pathMod.join(d, ${JSON.stringify(appName)})); } catch (_) { /* ok */ }
    });

    // Remove app directory
    fs.rmSync(appDir, { recursive: true, force: true });
    console.log('Uninstalled ${appName}.');
  });`;
}

function generateDaemonCommands(appName: string, serverBundleFilename: string): string {
  return `var daemonCmd = program.command('daemon').description('Daemon management');

daemonCmd
  .command('start')
  .description('Start as a background daemon')
  .option('-p, --port <port>', 'Port number', function(v) { return parseInt(v, 10); })
  .action(async function(opts) {
    var { spawn } = require('child_process');
    var fs = require('fs');
    var os = require('os');
    var pidDir = require('path').join(os.homedir(), '.frontmcp', 'pids');
    var logDir = require('path').join(os.homedir(), '.frontmcp', 'logs');
    fs.mkdirSync(pidDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });

    var env = Object.assign({}, process.env);
    if (opts.port) env.PORT = String(opts.port);

    var logPath = require('path').join(logDir, ${JSON.stringify(appName)} + '.log');
    var out = fs.openSync(logPath, 'a');
    var err = fs.openSync(logPath, 'a');

    var child = spawn('node', [SERVER_BUNDLE], {
      detached: true,
      stdio: ['ignore', out, err],
      env: env
    });

    var pidPath = require('path').join(pidDir, ${JSON.stringify(appName)} + '.pid');
    fs.writeFileSync(pidPath, JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }));
    child.unref();
    console.log('Daemon started (PID: ' + child.pid + '). Logs: ' + logPath);
  });

daemonCmd
  .command('stop')
  .description('Stop the daemon')
  .action(function() {
    var fs = require('fs');
    var os = require('os');
    var pidPath = require('path').join(os.homedir(), '.frontmcp', 'pids', ${JSON.stringify(appName)} + '.pid');
    try {
      var data = JSON.parse(fs.readFileSync(pidPath, 'utf8'));
      process.kill(data.pid, 'SIGTERM');
      fs.unlinkSync(pidPath);
      console.log('Daemon stopped (PID: ' + data.pid + ').');
    } catch (e) {
      console.log('No running daemon found.');
    }
  });

daemonCmd
  .command('status')
  .description('Check daemon status')
  .action(function() {
    var fs = require('fs');
    var os = require('os');
    var pidPath = require('path').join(os.homedir(), '.frontmcp', 'pids', ${JSON.stringify(appName)} + '.pid');
    try {
      var data = JSON.parse(fs.readFileSync(pidPath, 'utf8'));
      try { process.kill(data.pid, 0); console.log('Running (PID: ' + data.pid + ', started: ' + data.startedAt + ')'); }
      catch (_) { console.log('Not running (stale PID file).'); fs.unlinkSync(pidPath); }
    } catch (_) { console.log('Not running.'); }
  });

daemonCmd
  .command('logs')
  .description('Tail daemon logs')
  .option('-n, --lines <n>', 'Number of lines', function(v) { return parseInt(v, 10); }, 50)
  .action(function(opts) {
    var fs = require('fs');
    var os = require('os');
    var logPath = require('path').join(os.homedir(), '.frontmcp', 'logs', ${JSON.stringify(appName)} + '.log');
    try {
      var content = fs.readFileSync(logPath, 'utf8');
      var lines = content.split('\\n');
      var start = Math.max(0, lines.length - opts.lines);
      console.log(lines.slice(start).join('\\n'));
    } catch (_) { console.log('No logs found.'); }
  });`;
}

function generateFooter(): string {
  return `program.parseAsync(process.argv).catch(function(err) {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});`;
}

function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
