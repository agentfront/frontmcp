/**
 * Generates the CLI entry point TypeScript/JavaScript source code.
 * This creates a commander.js-based CLI where each MCP tool is a subcommand.
 */

import { type CliConfig, type OAuthConfig } from '../config';
import { EXTRACT_PUBLIC_MESSAGE_SNIPPET } from './extract-public-message.snippet';
import { type ExtractedSchema, type ExtractedTool, type ExtractedPrompt, type ExtractedResourceTemplate, type ExtractedCapabilities, type ExtractedJob, SYSTEM_TOOL_NAMES } from './schema-extractor';
import { schemaToCommander, generateOptionCode, camelToKebab } from './schema-to-commander';

export const RESERVED_COMMANDS = new Set([
  'resource', 'template', 'prompt', 'subscribe',
  'login', 'logout', 'connect', 'serve', 'daemon',
  'doctor', 'install', 'uninstall', 'sessions', 'help', 'version',
  'skills', 'job', 'workflow',
  // Reserved by the symmetric `prompt get <name>` / `resource read <uri>`
  // sub-API; included so a user-defined entry can never shadow them.
  'get', 'list', 'read',
]);

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
  oauthConfig?: OAuthConfig;
  /** When true, generate static requires that esbuild can resolve (for SEA builds). */
  selfContained?: boolean;
}

/**
 * Resolve tool command name, appending '-tool' suffix if it conflicts with a built-in command.
 * Returns { cmdName, wasRenamed } so the caller can log a warning at build time.
 */
export function resolveToolCommandName(toolName: string): { cmdName: string; wasRenamed: boolean } {
  const cmdName = camelToKebab(toolName).replace(/_/g, '-');
  if (RESERVED_COMMANDS.has(cmdName)) {
    return { cmdName: `${cmdName}-tool`, wasRenamed: true };
  }
  return { cmdName, wasRenamed: false };
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
    oauthConfig,
    authRequired,
  } = options;

  const capabilities = schema.capabilities;

  const filteredTools = schema.tools.filter(
    (t) => !excludeTools.includes(t.name) && !SYSTEM_TOOL_NAMES.has(t.name),
  );

  const selfContained = !!options.selfContained;

  const sections: string[] = [
    generateHeader(appName, appVersion, description, serverBundleFilename, outputDefault, authRequired, capabilities, oauthConfig, selfContained),
    generateToolCommands(filteredTools, appName),
    generateResourceCommands(schema),
    generateTemplateCommands(schema.resourceTemplates),
    generatePromptCommands(schema.prompts),
    capabilities.skills ? generateSkillsCommands() : '',
    capabilities.jobs ? generateJobCommands(schema.jobs) : '',
    capabilities.workflows ? generateWorkflowCommands() : '',
    generateSubscribeCommands(),
    ...(authRequired ? [
      generateLoginCommand(appName, oauthConfig),
      generateLogoutCommand(appName),
      generateSessionCommands(),
    ] : []),
    generateServeCommand(serverBundleFilename, selfContained),
    generateDoctorCommand(appName, options.nativeDeps),
    generateInstallCommand(appName, options.nativeDeps, selfContained),
    generateDaemonCommands(appName, serverBundleFilename, selfContained),
    generateFooter(),
  ];

  return sections.filter(Boolean).join('\n\n');
}

function generateHeader(
  appName: string,
  appVersion: string,
  description: string,
  serverBundleFilename: string,
  outputDefault: string,
  authRequired: boolean,
  capabilities: ExtractedCapabilities,
  oauthConfig?: OAuthConfig,
  selfContained?: boolean,
): string {
  const hasOAuth = !!oauthConfig;

  // Build the group routing map dynamically
  const skillsRouting = capabilities.skills ? `\n      else if (name === 'skills') groups['Skills'].push(sub);` : '';
  const jobsRouting = capabilities.jobs ? `\n      else if (name === 'job') groups['Jobs'].push(sub);` : '';
  const workflowsRouting = capabilities.workflows ? `\n      else if (name === 'workflow') groups['Workflows'].push(sub);` : '';
  const authRouting = authRequired ? `\n      else if (['login', 'logout', 'sessions', 'connect'].indexOf(name) !== -1) groups['Auth'].push(sub);` : '';

  // Build the groups object dynamically
  const groupEntries: string[] = [
    `      'Tools': []`,
    `      'Resources & Prompts': []`,
  ];
  if (capabilities.skills) groupEntries.push(`      'Skills': []`);
  if (capabilities.jobs) groupEntries.push(`      'Jobs': []`);
  if (capabilities.workflows) groupEntries.push(`      'Workflows': []`);
  if (authRequired) groupEntries.push(`      'Auth': []`);
  groupEntries.push(`      'Subscriptions': []`);
  groupEntries.push(`      'System': []`);

  return `'use strict';
${selfContained ? `
// SEA daemon mode: when spawned by 'daemon start', run the server directly
// using the inlined (bundled) server code — no external requires needed.
if (process.env.__FRONTMCP_DAEMON_MODE === '1') {
  require('reflect-metadata');
  // Suppress @FrontMcp decorator auto-bootstrap — daemon handles bootstrap explicitly below.
  process.env.FRONTMCP_SCHEMA_EXTRACT = '1';
  var _dMod = require(${JSON.stringify('../' + serverBundleFilename)});
  delete process.env.FRONTMCP_SCHEMA_EXTRACT;
  var _dSdk = require('@frontmcp/sdk');
  var _FMI = _dSdk.FrontMcpInstance || _dSdk.default.FrontMcpInstance;
  var _raw = _dMod.default || _dMod;
  var _cfg = (typeof _raw === 'function' && typeof Reflect !== 'undefined' && Reflect.getMetadata)
    ? (Reflect.getMetadata('__frontmcp:config', _raw) || _raw) : _raw;
  var _dp = process.env.FRONTMCP_DAEMON_PORT;
  if (_dp) {
    var _port = parseInt(_dp, 10);
    _cfg = Object.assign({}, _cfg, { http: Object.assign({}, _cfg.http || {}, { port: _port }) });
    process.env.PORT = _dp;
    _FMI.bootstrap(_cfg)
      .then(function() { console.log('Daemon listening on port ' + _port); })
      .catch(function(e) { console.error('Daemon failed:', e); process.exit(1); });
  } else {
    var _sp = process.env.FRONTMCP_DAEMON_SOCKET;
    _FMI.runUnixSocket(Object.assign({}, _cfg, { socketPath: _sp }))
      .then(function() { console.log('Daemon listening on ' + _sp); })
      .catch(function(e) { console.error('Daemon failed:', e); process.exit(1); });
  }
  return;
}
` : ''}
// Stdio mode: when --stdio is passed, run as an MCP stdio server (stdin/stdout JSON-RPC).
// Detected early before commander to avoid overhead and ensure stdout stays clean for MCP protocol.
// Logs go to ~/.frontmcp/logs/{appName}-*.log — stdout is reserved for MCP JSON-RPC only.
if (process.argv.includes('--stdio')) {
  // Set app name for file logging before any initialization
  process.env.FRONTMCP_APP_NAME = process.env.FRONTMCP_APP_NAME || ${JSON.stringify(appName)};
  require('reflect-metadata');
  process.env.FRONTMCP_SCHEMA_EXTRACT = '1';
  var _sMod = require(${selfContained ? `${JSON.stringify('../' + serverBundleFilename)}` : `require('path').join(__dirname, ${JSON.stringify(serverBundleFilename)})`});
  delete process.env.FRONTMCP_SCHEMA_EXTRACT;
  var _sSdk = require('@frontmcp/sdk');
  var _sFMI = _sSdk.FrontMcpInstance || _sSdk.default.FrontMcpInstance;
  var _sRaw = _sMod.default || _sMod;
  var _sCfg = (typeof _sRaw === 'function' && typeof Reflect !== 'undefined' && Reflect.getMetadata)
    ? (Reflect.getMetadata('__frontmcp:config', _sRaw) || _sRaw) : _sRaw;
  _sFMI.runStdio(_sCfg)
    .catch(function(e) { console.error('Stdio server failed:', e); process.exit(1); });
  return;
}

var { Command, Option } = require('commander');
var path = require('path');
var fs = require('fs');
var os = require('os');
var fmt = require('./output-formatter');
${authRequired ? "var sessions = require('./session-manager');\nvar creds = require('./credential-store');" : ''}
${hasOAuth ? "var oauthHelper = require('./oauth-helper');" : ''}

var APP_NAME = ${JSON.stringify(appName)};
var SCRIPT_DIR = __dirname;
var FRONTMCP_HOME = process.env.FRONTMCP_HOME || path.join(os.homedir(), '.frontmcp');
// Set app name for file logger (writes to ~/.frontmcp/logs/{appName}-{timestamp}.log)
process.env.FRONTMCP_APP_NAME = process.env.FRONTMCP_APP_NAME || APP_NAME;
${selfContained
    ? `// Self-contained: server bundle and SDK are inlined by esbuild
var SERVER_BUNDLE = '../${serverBundleFilename}';`
    : `var SERVER_BUNDLE = path.join(SCRIPT_DIR, ${JSON.stringify(serverBundleFilename)});`}

var _client = null;
async function getClient() {
  if (_client) return _client;

  // Try daemon first — Unix socket HTTP (~5-15ms vs ~420ms in-process)
  var socketPath = path.join(FRONTMCP_HOME, 'sockets', APP_NAME + '.sock');
  if (fs.existsSync(socketPath)) {
    try {
      var daemonClient = require('./daemon-client');
      var dc = daemonClient.createDaemonClient(socketPath);
      await dc.ping();
      _client = dc;
      return _client;
    } catch (_) { /* daemon not available, fall through */ }
  }

  // Fallback: in-process connect (with CLI mode for faster init)
  // Suppress @FrontMcp decorator bootstrap — we only need config metadata, not a running server.
  process.env.FRONTMCP_SCHEMA_EXTRACT = '1';
  var mod = require(${selfContained ? `'../${serverBundleFilename}'` : 'SERVER_BUNDLE'});
  delete process.env.FRONTMCP_SCHEMA_EXTRACT;
  var configOrClass = mod.default || mod;
  var sdk = require('@frontmcp/sdk');
  var connect = sdk.connect || sdk.direct.connect;${authRequired ? `
  var sessionName = sessions.getActiveSessionName();
  var store = creds.createCredentialStore();
  var credBlob = await store.get(sessionName);
  var connectOpts = credBlob ? { authToken: credBlob.token, mode: 'cli' } : { mode: 'cli' };
  _client = await connect(configOrClass, connectOpts);` : `
  _client = await connect(configOrClass, { mode: 'cli' });`}
  return _client;
}

async function closeClient() {
  if (_client && typeof _client.close === 'function') {
    try { await _client.close(); } catch (_) {}
  }
  _client = null;
}

// Flag set by long-running commands (serve, daemon) to prevent the footer from calling process.exit().
var _isLongRunning = false;

${EXTRACT_PUBLIC_MESSAGE_SNIPPET}

var program = new Command();
// Make Commander's own usage errors (unknown subcommand, missing required option,
// invalid value) exit with code 2 instead of the default 0 — matches POSIX
// convention and lets shell scripts/CI distinguish runtime failures from usage.
//
// Sets process.exitCode and re-throws so the parseAsync() footer can run
// closeClient() / native-addon teardown before the actual exit. Calling
// process.exit() directly here would skip that and could leave better-sqlite3
// / ONNX / file handles in a corrupt state for short-lived runs.
program.exitOverride(function(err) {
  if (err.code === 'commander.helpDisplayed' || err.code === 'commander.help' || err.code === 'commander.version') {
    process.exitCode = 0;
  } else if (err.code === 'commander.unknownCommand' || err.code === 'commander.unknownOption' ||
      err.code === 'commander.missingArgument' || err.code === 'commander.missingMandatoryOptionValue' ||
      err.code === 'commander.invalidArgument' || err.code === 'commander.optionMissingArgument' ||
      err.code === 'commander.invalidOptionArgument' || err.code === 'commander.excessArguments') {
    process.exitCode = 2;
  } else {
    process.exitCode = 1;
  }
  // Re-throw so parseAsync().catch in the footer runs cleanup before exit.
  throw err;
});
program
  .name(${JSON.stringify(appName)})
  .version(${JSON.stringify(appVersion)})
  .description(${JSON.stringify(description || `${appName} CLI`)})
  .option('--output <mode>', 'Output format: text or json', ${JSON.stringify(outputDefault)})
  .option('--verbose', 'Enable verbose console logging (logs always go to ~/.frontmcp/logs/)')
  .option('--log-dir <path>', 'Directory for log files (default: ~/.frontmcp/logs/)');

// Wire --verbose and --log-dir to env vars early (before any command action runs).
// Parse argv directly since commander hooks may not be available in all versions.
(function() {
  var argv = process.argv;
  if (argv.indexOf('--verbose') !== -1) {
    process.env.FRONTMCP_CLI_VERBOSE = '1';
  }
  var logDirIdx = argv.indexOf('--log-dir');
  if (logDirIdx !== -1 && argv[logDirIdx + 1]) {
    process.env.FRONTMCP_LOG_DIR = argv[logDirIdx + 1];
  }
})();

program.configureHelp({
  sortSubcommands: false,
  formatHelp: function(cmd, helper) {
    var groups = {
${groupEntries.join(',\n')}
    };
    var toolCmdNames = cmd._toolCommandNames || [];
    cmd.commands.forEach(function(sub) {
      var name = sub.name();
      if (toolCmdNames.indexOf(name) !== -1) groups['Tools'].push(sub);
      else if (['resource', 'template', 'prompt'].indexOf(name) !== -1) groups['Resources & Prompts'].push(sub);${skillsRouting}${jobsRouting}${workflowsRouting}${authRouting}
      else if (name === 'subscribe') groups['Subscriptions'].push(sub);
      else groups['System'].push(sub);
    });
    var termWidth = helper.padWidth(cmd, helper);
    var lines = [];
    lines.push('Usage: ' + helper.commandUsage(cmd));
    lines.push('');
    var desc = helper.commandDescription(cmd);
    if (desc) { lines.push(desc); lines.push(''); }
    var globalOpts = helper.formatHelp ? helper.visibleOptions(cmd) : [];
    if (globalOpts.length > 0) {
      lines.push('Options:');
      globalOpts.forEach(function(opt) {
        lines.push('  ' + helper.optionTerm(opt).padEnd(termWidth) + '  ' + helper.optionDescription(opt));
      });
      lines.push('');
    }
    Object.keys(groups).forEach(function(groupName) {
      var cmds = groups[groupName];
      if (cmds.length === 0) return;
      lines.push(groupName + ':');
      cmds.forEach(function(sub) {
        lines.push('  ' + helper.subcommandTerm(sub).padEnd(termWidth) + '  ' + helper.subcommandDescription(sub));
      });
      lines.push('');
    });
    return lines.join('\\n');
  }
});

program.action(function() { program.outputHelp(); });`;
}

function generateToolCommands(tools: ExtractedTool[], appName: string): string {
  if (tools.length === 0) return '// No tools extracted\nprogram._toolCommandNames = [];';

  const cmdNames: string[] = [];
  const commands = tools.map((tool) => {
    const { cmdName } = resolveToolCommandName(tool.name);
    cmdNames.push(cmdName);
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
      // The SDK converts thrown errors into a CallToolResult with isError:true
      // (so HTTP/JSON-RPC clients still get a structured response). Detect
      // that here and map to a non-zero exit code so shell scripts can gate
      // on success — Zod input validation errors → exit 2 (usage), all
      // other tool errors → exit 1 (runtime).
      if (result && result.isError === true) {
        var rmeta = (result && result._meta) || {};
        process.exitCode = (rmeta.code === 'INVALID_INPUT') ? 2 : 1;
      }
    } catch (err) {
      var meta = err && err._meta ? err._meta : (err && err.data && err.data._meta ? err.data._meta : null);
      if (meta && meta.authorization_required) {
        console.error('Authorization required' + (meta.app ? ' for ' + meta.app : ''));
        if (meta.auth_url) console.error('Authorize at: ' + meta.auth_url);
        console.error('Or run: ' + ${JSON.stringify(appName)} + ' login');
        process.exitCode = 1;
      } else {
        // Thrown error path (transport / DI / pre-flow failure) — same
        // mapping as the isError result path above.
        var isUsage = err && err.code === 'INVALID_INPUT';
        _exitWithError(err, isUsage ? 2 : 1);
      }
    }
  });`;
  });

  return `program._toolCommandNames = ${JSON.stringify(cmdNames)};\n\n${commands.join('\n\n')}`;
}

function generateArgMapping(tool: ExtractedTool): string {
  const props = (tool.inputSchema as Record<string, unknown>).properties as Record<string, Record<string, unknown>> | undefined;
  if (!props) return '';

  const mappings = Object.keys(props).map((propName) => {
    const propSchema = props[propName];
    const kebab = camelToKebab(propName);
    // Commander converts kebab-case flags to camelCase in opts()
    const camel = kebabToCamel(kebab);

    // Resolve type for object detection
    let propType = propSchema?.type as string | string[] | undefined;
    if (Array.isArray(propType)) {
      propType = propType.find((t: string) => t !== 'null') || propType[0];
    }

    if (propType === 'object') {
      return `if (rawOpts[${JSON.stringify(camel)}] !== undefined) {
        try { args[${JSON.stringify(propName)}] = JSON.parse(rawOpts[${JSON.stringify(camel)}]); }
        catch (_jsonErr) { console.error('Invalid JSON for --${kebab}'); process.exitCode = 1; return; }
      }`;
    }

    return `if (rawOpts[${JSON.stringify(camel)}] !== undefined) args[${JSON.stringify(propName)}] = rawOpts[${JSON.stringify(camel)}];`;
  });

  return mappings.join('\n      ');
}

function generateJobArgMapping(inputSchema: Record<string, unknown>): string {
  const props = (inputSchema as Record<string, unknown>).properties as Record<string, Record<string, unknown>> | undefined;
  if (!props) return '';

  const mappings = Object.keys(props).map((propName) => {
    const propSchema = props[propName];
    const kebab = camelToKebab(propName);
    const camel = kebabToCamel(kebab);

    let propType = propSchema?.type as string | string[] | undefined;
    if (Array.isArray(propType)) {
      propType = propType.find((t: string) => t !== 'null') || propType[0];
    }

    if (propType === 'object') {
      return `if (rawOpts[${JSON.stringify(camel)}] !== undefined) {
        try { input[${JSON.stringify(propName)}] = JSON.parse(rawOpts[${JSON.stringify(camel)}]); }
        catch (_jsonErr) { console.error('Invalid JSON for --${kebab}'); process.exitCode = 1; return; }
      }`;
    }

    return `if (rawOpts[${JSON.stringify(camel)}] !== undefined) input[${JSON.stringify(propName)}] = rawOpts[${JSON.stringify(camel)}];`;
  });

  return mappings.join('\n      ');
}

function generateResourceCommands(_schema: ExtractedSchema): string {
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
      _exitWithError(err, 1);
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
      _exitWithError(err, 1);
    }
  });`;
}

function generateTemplateCommands(templates: ExtractedResourceTemplate[]): string {
  if (!templates || templates.length === 0) return '// No resource templates extracted';

  const subcommands = templates.map((tmpl) => {
    const cmdName = camelToKebab(tmpl.name).replace(/_/g, '-');
    // Extract {param} placeholders from URI template
    const paramNames = extractTemplateParams(tmpl.uriTemplate);
    const optionLines = paramNames
      .map((p) => `  .requiredOption('--${camelToKebab(p)} <value>', 'Template parameter: ${p}')`)
      .join('\n');

    const paramMapping = paramNames
      .map((p) => {
        const camel = kebabToCamel(camelToKebab(p));
        return `uri = uri.replace('{${p}}', encodeURIComponent(rawOpts[${JSON.stringify(camel)}]));`;
      })
      .join('\n      ');

    return `templateCmd
  .command(${JSON.stringify(cmdName)})
  .description(${JSON.stringify(tmpl.description || `Read resource from template: ${tmpl.uriTemplate}`)})
${optionLines}
  .action(async function(opts) {
    try {
      var client = await getClient();
      var rawOpts = this.opts();
      var uri = ${JSON.stringify(tmpl.uriTemplate)};
      ${paramMapping}
      var result = await client.readResource(uri);
      var mode = program.opts().output || 'text';
      console.log(fmt.formatResourceResult(result, mode));
    } catch (err) {
      _exitWithError(err, 1);
    }
  });`;
  });

  return `var templateCmd = program.command('template').description('Resource template operations');

templateCmd
  .command('list')
  .description('List available resource templates')
  .action(async function() {
    try {
      var client = await getClient();
      var result = await client.listResourceTemplates();
      var mode = program.opts().output || 'text';
      if (mode === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        var templates = result.resourceTemplates || [];
        if (templates.length === 0) { console.log('No resource templates available.'); return; }
        templates.forEach(function(t) {
          console.log('  ' + t.uriTemplate + (t.description ? ' - ' + t.description : ''));
        });
      }
    } catch (err) {
      _exitWithError(err, 1);
    }
  });

${subcommands.join('\n\n')}`;
}

function generatePromptCommands(prompts: ExtractedPrompt[]): string {
  // Map known prompts → option specs so `prompt get <name>` knows which flags
  // to accept per prompt. Unknown prompt names still call getPrompt() and
  // surface the server's error to the user.
  const promptArgsMap = prompts.map((p) => {
    const args = (p.arguments || []).map((a) => ({
      name: a.name,
      kebab: camelToKebab(a.name),
      camel: kebabToCamel(camelToKebab(a.name)),
      required: !!a.required,
    }));
    return `${JSON.stringify(p.name)}: ${JSON.stringify(args)}`;
  }).join(',\n      ');

  // #382 round-2 — collect the union of all known prompt-arg kebab names so we
  // can register them as `.option(--<name> <value>)` on `prompt get`. Without
  // these registrations, Commander treats the value tokens (e.g. `add` after
  // `--op`) as extra positional args and rejects them with
  // `too many arguments for 'get'. Expected 1 argument but got 7.` —
  // breaking every prompt that takes arguments. Per-prompt validation still
  // happens inside the action handler against `promptArgs[name]`, so a user
  // that types `--op` for a prompt that doesn't declare it gets a clear
  // "unknown option(s) for prompt" error rather than silent acceptance.
  const allKebabNames = new Set<string>();
  for (const p of prompts) {
    for (const a of p.arguments || []) {
      allKebabNames.add(camelToKebab(a.name));
    }
  }
  const promptGetOptionLines = Array.from(allKebabNames)
    .sort()
    .map((kebab) => `  .option(${JSON.stringify(`--${kebab} <value>`)}, '')`)
    .join('\n');

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
  .description(${JSON.stringify((prompt.description || '') + ' (deprecated alias — use `prompt get ' + cmdName + '`)')})
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
      _exitWithError(err, 1);
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
      _exitWithError(err, 1);
    }
  });

// Symmetric \`prompt get <name>\` to mirror \`resource read <uri>\`. Looks up
// per-prompt argument metadata from \`promptArgs\` and forwards as MCP
// \`prompts/get\` request arguments. Unknown / missing required flags exit 2.
//
// Robust flag parser supports:
//   --key value         (canonical form)
//   --key=value         (single-token form)
//   --bool              (boolean — value defaults to "true")
//   --                  (end-of-options marker; everything after is ignored)
// Unknown flags fail-fast with exit 2 instead of being silently dropped.
var promptArgs = {
      ${promptArgsMap}
    };
var _getCmd = promptCmd
  .command('get <name>')
  .description('Render a prompt by name')
${promptGetOptionLines}
  .allowUnknownOption(true)
  .allowExcessArguments(true) // #382 — without this, an out-of-spec flag like \`--bogus x\` becomes excess operands and Commander throws "too many arguments" before the action can emit the precise "unknown option(s) for prompt" error.
  .action(async function(name) {
    try {
      var spec = promptArgs[name];
      if (!spec) {
        console.error('Error: Unknown prompt: ' + name);
        process.exitCode = 1;
        return;
      }
      // Commander parsed registered options into rawOpts (camelCased). For
      // unregistered prompts (a flag a different prompt declares but this one
      // doesn't), fall back to scanning the raw token stream — that way an
      // out-of-spec --foo for "this" prompt still surfaces as an explicit
      // "unknown option(s)" error rather than being silently dropped.
      var rawOpts = this.opts();
      var rawTokens = this.args.slice(1);
      var args = {};
      var unknown = [];
      var byKebab = {};
      var byCamel = {};
      for (var s = 0; s < spec.length; s++) {
        byKebab[spec[s].kebab] = spec[s];
        byCamel[spec[s].camel] = spec[s];
      }
      // 1. Pull values from Commander-parsed options (registered names).
      for (var camelKey in rawOpts) {
        if (Object.prototype.hasOwnProperty.call(rawOpts, camelKey)) {
          var matchByCamel = byCamel[camelKey];
          if (matchByCamel) {
            args[matchByCamel.name] = rawOpts[camelKey];
          }
        }
      }
      // 2. Scan rawTokens for any --<flag> not in this prompt's spec — those
      //    are real "unknown for this prompt" errors. (Commander already
      //    consumed the registered ones; only out-of-spec flags survive here
      //    via .allowUnknownOption(true).)
      for (var i = 0; i < rawTokens.length; i++) {
        var tok = rawTokens[i];
        if (tok === '--') break;
        if (typeof tok !== 'string' || tok.indexOf('--') !== 0) continue;
        var keyAndVal = tok.slice(2);
        var eq = keyAndVal.indexOf('=');
        var key = eq >= 0 ? keyAndVal.slice(0, eq) : keyAndVal;
        if (!byKebab[key]) {
          unknown.push('--' + key);
        }
      }
      if (unknown.length > 0) {
        console.error('Error: unknown option(s) for prompt "' + name + '": ' + unknown.join(', '));
        process.exitCode = 2;
        return;
      }
      // 3. Validate required args.
      for (var r = 0; r < spec.length; r++) {
        if (spec[r].required && args[spec[r].name] === undefined) {
          console.error('Error: missing required option --' + spec[r].kebab);
          process.exitCode = 2;
          return;
        }
      }
      var client = await getClient();
      var result = await client.getPrompt(name, args);
      var mode = program.opts().output || 'text';
      console.log(fmt.formatPromptResult(result, mode));
    } catch (err) {
      _exitWithError(err, 1);
    }
  });

${subcommands.join('\n\n')}`;
}

function generateSkillsCommands(): string {
  return `var skillsCmd = program.command('skills').description('Skill operations');

skillsCmd
  .command('search [query]')
  .description('Search for skills')
  .action(async function(query) {
    try {
      var client = await getClient();
      var result = await client.searchSkills(query || '');
      var mode = program.opts().output || 'text';
      if (mode === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        var skills = result.skills || [];
        if (skills.length === 0) { console.log('No skills found.'); return; }
        console.log('\\n  Skills matching "' + (query || '') + '":\\n');
        skills.forEach(function(s) {
          var tags = (s.tags || []).slice(0, 3).join(', ');
          var score = s.score != null ? ' [score: ' + Number(s.score).toFixed(2) + ']' : '';
          console.log('  ' + (s.name || s.id) + score);
          if (s.description) console.log('    ' + s.description.split('. Use when')[0]);
          if (tags) console.log('    tags: ' + tags);
          console.log('');
        });
        console.log('  ' + skills.length + ' result(s).');
        console.log("  Use '" + program.name() + " skills read <name>' for full details.");
        console.log("  Use '" + program.name() + " skills load <name>' to load a skill.\\n");
      }
    } catch (err) {
      _exitWithError(err, 1);
    }
  });

skillsCmd
  .command('load <ids...>')
  .description('Load skills by ID')
  .action(async function(ids) {
    try {
      var client = await getClient();
      var result = await client.loadSkills(ids);
      var mode = program.opts().output || 'text';
      if (mode === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('Loaded ' + ids.length + ' skill(s).');
        if (result && typeof result === 'object') {
          console.log(JSON.stringify(result, null, 2));
        }
      }
    } catch (err) {
      _exitWithError(err, 1);
    }
  });

skillsCmd
  .command('read <name>')
  .description('Read full details for a skill')
  .action(async function(name) {
    try {
      var client = await getClient();
      var result = await client.loadSkills([name]);
      var mode = program.opts().output || 'text';
      if (mode === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        var skills = result.skills || [];
        if (skills.length === 0) { console.log('Skill "' + name + '" not found.'); return; }
        var sk = skills[0];
        console.log('\\n  ' + sk.name);
        if (sk.description) console.log('  ' + sk.description);
        console.log('');
        if (sk.instructions) {
          console.log(sk.instructions);
          console.log('');
        }
        if (sk.tools && sk.tools.length > 0) {
          console.log('  Tools (' + sk.tools.length + '):');
          sk.tools.forEach(function(t) {
            console.log('    ' + t.name + (t.available ? '' : ' (unavailable)'));
          });
          console.log('');
        }
        if (result.nextSteps) console.log('  ' + result.nextSteps);
        console.log("  Load: " + program.name() + " skills load " + name + '\\n');
      }
    } catch (err) {
      _exitWithError(err, 1);
    }
  });

skillsCmd
  .command('list')
  .description('List available skills')
  .action(async function() {
    try {
      var client = await getClient();
      var result = await client.listSkills();
      var mode = program.opts().output || 'text';
      if (mode === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        var skills = result.skills || [];
        if (skills.length === 0) { console.log('No skills available.'); return; }
        console.log('\\n  Available Skills (' + skills.length + '):\\n');
        skills.forEach(function(s) {
          var desc = s.description ? s.description.split('. Use when')[0] : '';
          console.log('  ' + (s.name || s.id));
          if (desc) console.log('    ' + desc);
          console.log('');
        });
        console.log("  Use '" + program.name() + " skills search <query>' for semantic search.");
        console.log("  Use '" + program.name() + " skills read <name>' for full details.\\n");
      }
    } catch (err) {
      _exitWithError(err, 1);
    }
  });`;
}

function generateJobCommands(jobs: ExtractedJob[]): string {
  // Generate typed 'run' subcommands for each known job
  const runSubcommands = jobs.map((job) => {
    const jobCmdName = camelToKebab(job.name).replace(/_/g, '-');

    if (job.inputSchema) {
      const { options } = schemaToCommander(job.inputSchema);
      const optionLines = options.map((o) => `  ${generateOptionCode(o)}`).join('\n');
      const argMapping = generateJobArgMapping(job.inputSchema);

      return `jobRunCmd
  .command(${JSON.stringify(jobCmdName)})
  .description(${JSON.stringify(job.description || `Run the ${job.name} job`)})
${optionLines}
  .option('--background', 'Run in background mode')
  .action(async function(opts) {
    try {
      var client = await getClient();
      var input = {};
      var rawOpts = this.opts();
      ${argMapping}
      var result = await client.executeJob(${JSON.stringify(job.name)}, input, { background: !!rawOpts.background });
      var mode = program.opts().output || 'text';
      if (mode === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (rawOpts.background && result && result.runId) {
          console.log('Job started. Run ID: ' + result.runId);
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      }
    } catch (err) {
      _exitWithError(err, 1);
    }
  });`;
    }

    // No inputSchema — fall back to generic --input <json>
    return `jobRunCmd
  .command(${JSON.stringify(jobCmdName)})
  .description(${JSON.stringify(job.description || `Run the ${job.name} job`)})
  .option('--input <json>', 'Job input as JSON string')
  .option('--background', 'Run in background mode')
  .action(async function(opts) {
    try {
      var client = await getClient();
      var input = {};
      if (opts.input) {
        try { input = JSON.parse(opts.input); }
        catch (_) { console.error('Invalid JSON for --input'); process.exitCode = 1; return; }
      }
      var result = await client.executeJob(${JSON.stringify(job.name)}, input, { background: !!opts.background });
      var mode = program.opts().output || 'text';
      if (mode === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (opts.background && result && result.runId) {
          console.log('Job started. Run ID: ' + result.runId);
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      }
    } catch (err) {
      _exitWithError(err, 1);
    }
  });`;
  });

  // Generic fallback 'run' for jobs not known at build time
  const genericRun = `jobRunCmd
  .command('_run <name>')
  .description('Run a job by name (generic)')
  .option('--input <json>', 'Job input as JSON string')
  .option('--background', 'Run in background mode')
  .action(async function(name, opts) {
    try {
      var client = await getClient();
      var input = {};
      if (opts.input) {
        try { input = JSON.parse(opts.input); }
        catch (_) { console.error('Invalid JSON for --input'); process.exitCode = 1; return; }
      }
      var result = await client.executeJob(name, input, { background: !!opts.background });
      var mode = program.opts().output || 'text';
      if (mode === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (opts.background && result && result.runId) {
          console.log('Job started. Run ID: ' + result.runId);
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      }
    } catch (err) {
      _exitWithError(err, 1);
    }
  });`;

  return `var jobCmd = program.command('job').description('Job operations');

jobCmd
  .command('list')
  .description('List available jobs')
  .action(async function() {
    try {
      var client = await getClient();
      var result = await client.listJobs();
      var mode = program.opts().output || 'text';
      if (mode === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        var jobs = result.jobs || result || [];
        if (Array.isArray(jobs) && jobs.length === 0) { console.log('No jobs available.'); return; }
        if (Array.isArray(jobs)) {
          jobs.forEach(function(j) {
            console.log('  ' + (j.name || j.id || JSON.stringify(j)));
          });
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      }
    } catch (err) {
      _exitWithError(err, 1);
    }
  });

var jobRunCmd = jobCmd.command('run').description('Run a job');

${runSubcommands.join('\n\n')}

${jobs.length > 0 ? genericRun : `jobRunCmd
  .argument('<name>', 'Job name')
  .option('--input <json>', 'Job input as JSON string')
  .option('--background', 'Run in background mode')
  .action(async function(name, opts) {
    try {
      var client = await getClient();
      var input = {};
      if (opts.input) {
        try { input = JSON.parse(opts.input); }
        catch (_) { console.error('Invalid JSON for --input'); process.exitCode = 1; return; }
      }
      var result = await client.executeJob(name, input, { background: !!opts.background });
      var mode = program.opts().output || 'text';
      if (mode === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (opts.background && result && result.runId) {
          console.log('Job started. Run ID: ' + result.runId);
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      }
    } catch (err) {
      _exitWithError(err, 1);
    }
  });`}

jobCmd
  .command('status <runId>')
  .description('Get the status of a job run')
  .action(async function(runId) {
    try {
      var client = await getClient();
      var result = await client.getJobStatus(runId);
      var mode = program.opts().output || 'text';
      if (mode === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('Status: ' + (result.status || JSON.stringify(result)));
      }
    } catch (err) {
      _exitWithError(err, 1);
    }
  });`;
}

function generateWorkflowCommands(): string {
  return `var workflowCmd = program.command('workflow').description('Workflow operations');

workflowCmd
  .command('list')
  .description('List available workflows')
  .action(async function() {
    try {
      var client = await getClient();
      var result = await client.listWorkflows();
      var mode = program.opts().output || 'text';
      if (mode === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        var workflows = result.workflows || result || [];
        if (Array.isArray(workflows) && workflows.length === 0) { console.log('No workflows available.'); return; }
        if (Array.isArray(workflows)) {
          workflows.forEach(function(w) {
            console.log('  ' + (w.name || w.id || JSON.stringify(w)));
          });
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      }
    } catch (err) {
      _exitWithError(err, 1);
    }
  });

workflowCmd
  .command('run <name>')
  .description('Run a workflow by name')
  .option('--input <json>', 'Workflow input as JSON string')
  .option('--background', 'Run in background mode')
  .action(async function(name, opts) {
    try {
      var client = await getClient();
      var input = {};
      if (opts.input) {
        try { input = JSON.parse(opts.input); }
        catch (_) { console.error('Invalid JSON for --input'); process.exitCode = 1; return; }
      }
      var result = await client.executeWorkflow(name, input, { background: !!opts.background });
      var mode = program.opts().output || 'text';
      if (mode === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (opts.background && result && result.runId) {
          console.log('Workflow started. Run ID: ' + result.runId);
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      }
    } catch (err) {
      _exitWithError(err, 1);
    }
  });

workflowCmd
  .command('status <runId>')
  .description('Get the status of a workflow run')
  .action(async function(runId) {
    try {
      var client = await getClient();
      var result = await client.getWorkflowStatus(runId);
      var mode = program.opts().output || 'text';
      if (mode === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('Status: ' + (result.status || JSON.stringify(result)));
      }
    } catch (err) {
      _exitWithError(err, 1);
    }
  });`;
}

function generateSubscribeCommands(): string {
  return `
// Subscribe commands need push support (onNotification/onResourceUpdated).
// Daemon HTTP cannot push, so we force in-process when daemon was used.
async function getSubscribeClient() {
  var client = await getClient();
  // If connected via daemon, the onNotification/onResourceUpdated are no-ops.
  // Reconnect via in-process for push support.
  if (client._isDaemon) {
    // Close the daemon client before replacing with in-process client
    if (typeof client.close === 'function') { try { await client.close(); } catch (_) {} }
    _client = null;
    var mod = require(SERVER_BUNDLE);
    var configOrClass = mod.default || mod;
    var sdk = require('@frontmcp/sdk');
    var connect = sdk.connect || sdk.direct.connect;
    _client = await connect(configOrClass, { mode: 'cli' });
    return _client;
  }
  return client;
}

var subscribeCmd = program.command('subscribe').description('Subscribe to updates');

subscribeCmd
  .command('resource <uri>')
  .description('Stream resource updates (Ctrl+C to stop)')
  .action(async function(uri) {
    try {
      var client = await getSubscribeClient();
      await client.subscribeResource(uri);
      var mode = program.opts().output || 'text';
      console.log('Subscribed to resource: ' + uri);
      console.log('Waiting for updates... (Ctrl+C to stop)\\n');
      client.onResourceUpdated(function(uri) {
        console.log(fmt.formatSubscriptionEvent({ type: 'resource_updated', uri: uri, timestamp: new Date().toISOString() }, mode));
      });
      process.on('SIGINT', async function() {
        console.log('\\nUnsubscribing...');
        try { await client.unsubscribeResource(uri); } catch (_) { /* ok */ }
        await closeClient();
        process.exit(0);
      });
      // Keep process alive — setInterval creates an active event loop handle
      // so Node.js won't exit even with InMemoryTransport (no persistent I/O)
      setInterval(function() {}, 2147483647);
      await new Promise(function() {});
    } catch (err) {
      _exitWithError(err, 1);
    }
  });

subscribeCmd
  .command('notification <name>')
  .description('Stream notifications (Ctrl+C to stop)')
  .action(async function(name) {
    try {
      var client = await getSubscribeClient();
      var mode = program.opts().output || 'text';
      console.log('Listening for notification: ' + name);
      console.log('Waiting for events... (Ctrl+C to stop)\\n');
      client.onNotification(function(notification) {
        if (notification.method === name || name === '*') {
          console.log(fmt.formatSubscriptionEvent({ type: 'notification', method: notification.method, params: notification.params, timestamp: new Date().toISOString() }, mode));
        }
      });
      process.on('SIGINT', async function() {
        console.log('\\nStopping...');
        await closeClient();
        process.exit(0);
      });
      // Keep process alive — setInterval creates an active event loop handle
      // so Node.js won't exit even with InMemoryTransport (no persistent I/O)
      setInterval(function() {}, 2147483647);
      await new Promise(function() {});
    } catch (err) {
      _exitWithError(err, 1);
    }
  });`;
}

function generateLoginCommand(appName: string, oauthConfig?: OAuthConfig): string {
  const serverUrl = oauthConfig?.serverUrl || '';
  const clientId = oauthConfig?.clientId || appName;
  const defaultScope = oauthConfig?.defaultScope || '';
  const portStart = oauthConfig?.portRange?.[0] ?? 17830;
  const portEnd = oauthConfig?.portRange?.[1] ?? 17850;
  const timeout = oauthConfig?.timeout ?? 120000;

  return `program
  .command('login')
  .description('Authenticate via OAuth')
  .option('--server <url>', 'Server URL for OAuth'${serverUrl ? `, ${JSON.stringify(serverUrl)}` : ''})
  .option('--session <name>', 'Session name', 'default')
  .option('--scope <scopes>', 'OAuth scopes'${defaultScope ? `, ${JSON.stringify(defaultScope)}` : ''})
  .option('--no-browser', 'Print URL instead of opening browser')
  .action(async function(opts) {
    var serverUrl = opts.server || process.env.FRONTMCP_SERVER_URL || ${JSON.stringify(serverUrl)};
    if (!serverUrl) {
      console.error('Server URL required. Use --server <url> or set FRONTMCP_SERVER_URL.');
      process.exitCode = 1;
      return;
    }
    try {
      var oauthHelper = require('./oauth-helper');
      var result = await oauthHelper.startOAuthLogin({
        serverUrl: serverUrl,
        clientId: ${JSON.stringify(clientId)},
        scope: opts.scope || ${JSON.stringify(defaultScope)},
        portStart: ${portStart},
        portEnd: ${portEnd},
        timeout: ${timeout},
        noBrowser: !opts.browser
      });
      var sessionName = opts.session || 'default';
      var store = creds.createCredentialStore();
      await store.set(sessionName, result);
      sessions.getOrCreateSession(sessionName);
      console.log('Logged in successfully. Session: ' + sessionName);
    } catch (err) {
      console.error('Login failed:', err.message || err);
      process.exitCode = 1;
    }
  });`;
}

function generateLogoutCommand(_appName: string): string {
  return `program
  .command('logout')
  .description('Clear stored credentials')
  .option('--session <name>', 'Session to log out')
  .option('--all', 'Log out of all sessions')
  .action(async function(opts) {
    var store = creds.createCredentialStore();
    if (opts.all) {
      var allSessions = await store.list();
      for (var i = 0; i < allSessions.length; i++) {
        await store.delete(allSessions[i]);
      }
      console.log('Logged out of ' + allSessions.length + ' session(s).');
    } else {
      var sessionName = opts.session || sessions.getActiveSessionName();
      await store.delete(sessionName);
      console.log('Logged out of session: ' + sessionName);
    }
  });`;
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

function generateServeCommand(serverBundleFilename: string, selfContained?: boolean): string {
  // In self-contained/SEA mode, use a static relative require that esbuild can resolve at bundle time.
  // In normal mode, use dynamic path.join for runtime resolution from disk.
  const requireExpr = selfContained
    ? `require(${JSON.stringify('../' + serverBundleFilename)})`
    : `require(path.join(SCRIPT_DIR, ${JSON.stringify(serverBundleFilename)}))`;

  return `program
  .command('serve')
  .description('Start the MCP server')
  .option('-p, --port <port>', 'Port number', function(v) { return parseInt(v, 10); })
  .option('--stdio', 'Run as stdio transport (stdin/stdout JSON-RPC) for use in .mcp.json')
  .action(async function(opts) {
    if (opts.stdio) {
      // --stdio on serve is handled by the early argv check at the top of the entry;
      // this branch is a fallback in case commander parsed it first.
      _isLongRunning = true;
      process.env.FRONTMCP_SCHEMA_EXTRACT = '1';
      var sMod = ${requireExpr};
      delete process.env.FRONTMCP_SCHEMA_EXTRACT;
      var sRaw = sMod.default || sMod;
      var sSdk = require('@frontmcp/sdk');
      var sFMI = sSdk.FrontMcpInstance || sSdk.default.FrontMcpInstance;
      var sCfg = (typeof sRaw === 'function' && typeof Reflect !== 'undefined' && Reflect.getMetadata)
        ? (Reflect.getMetadata('__frontmcp:config', sRaw) || sRaw) : sRaw;
      await sFMI.runStdio(sCfg);
      return;
    }
    _isLongRunning = true;
    // Suppress @FrontMcp decorator auto-bootstrap during require() — the CLI
    // serve command handles bootstrap explicitly below with port/config overrides.
    process.env.FRONTMCP_SCHEMA_EXTRACT = '1';
    var mod = ${requireExpr};
    delete process.env.FRONTMCP_SCHEMA_EXTRACT;
    if (opts.port) process.env.PORT = String(opts.port);
    // If the bundle exports a start() function (@FrontMcp-decorated class auto-bootstraps), use it
    if (typeof mod.start === 'function') { await mod.start(); return; }
    if (typeof mod.default?.start === 'function') { await mod.default.start(); return; }
    // Otherwise, bootstrap the plain config object via FrontMcpInstance
    var raw = mod.default || mod;
    var sdk = require('@frontmcp/sdk');
    var FrontMcpInstance = sdk.FrontMcpInstance || sdk.default.FrontMcpInstance;
    var config = (typeof raw === 'function' && typeof Reflect !== 'undefined' && Reflect.getMetadata)
      ? (Reflect.getMetadata('__frontmcp:config', raw) || raw) : raw;
    if (opts.port) config = Object.assign({}, config, { http: Object.assign({}, config.http || {}, { port: opts.port }) });
    await FrontMcpInstance.bootstrap(config);
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

    // Check FRONTMCP_HOME directory
    var fs = require('fs');
    var appDir = require('path').join(FRONTMCP_HOME, 'apps', ${JSON.stringify(appName)});
    if (fs.existsSync(appDir)) {
      console.log('  [ok] App directory: ' + appDir);
    } else {
      console.log('  [!!] App directory not found: ' + appDir);
      ok = false;
      if (opts.fix) {
        fs.mkdirSync(appDir, { recursive: true });
        console.log('      [fixed] Created ' + appDir);
      }
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
  selfContained?: boolean,
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

  return `function _frontmcpCollectArg(value, acc) { return Array.isArray(acc) ? acc.concat(value) : [value]; }

program
  .command('install')
  .description('Install to ~/.frontmcp/ and set up dependencies, OR emit an IDE plugin (use -p)')
  .option('--prefix <path>', 'Installation prefix directory')
  .option('--bin-dir <path>', 'Directory for symlink (default: ~/.local/bin or /usr/local/bin)')
  .option('-p, --provider <provider>', 'Emit plugin for provider: claude | codex (repeatable)', _frontmcpCollectArg, [])
  .option('--scope <scope>', 'Plugin scope when -p is set: project | user', 'project')
  .option('--no-skills', 'Skip the skills/ subtree (when -p claude)')
  .option('--no-commands', 'Skip the commands/ subtree (when -p claude)')
  .option('--only-mcp', 'Skip plugin folder; just register the MCP server')
  .option('--command <cmd>', 'Override MCP server invocation in the plugin manifest')
  .option('--env <name>', 'Add env-var placeholder to plugin manifest (repeatable)', _frontmcpCollectArg, [])
  .option('--dir <dir>', 'Override plugin destination root')
  .option('--dry-run', 'Print plan; do not write')
  .option('--status', 'Print install status per provider; exit 0')
  .action(async function(opts) {
    var fs = require('fs');
    var pathMod = require('path');
    var os = require('os');
    var exec = require('child_process').execSync;

    // Issue #411 — when -p is set OR --status is set, run the plugin-install
    // path instead of the legacy bundle-copy + symlink behavior.
    var providers = Array.isArray(opts.provider) ? opts.provider : [];
    if (opts.status || providers.length > 0) {
      var emitter = require('./plugin-emitter');
      var binMetaPath = pathMod.join(SCRIPT_DIR, 'bin-meta.json');
      var meta;
      try { meta = JSON.parse(fs.readFileSync(binMetaPath, 'utf8')); }
      catch (e) {
        console.error('Could not read bin-meta.json at ' + binMetaPath + '. Was the bin built with a recent frontmcp?');
        process.exit(1);
      }
      var pkgJsonPath = pathMod.join(__dirname, '..', '..', 'package.json');
      var cliVersion = '0.0.0';
      try { cliVersion = (require(pkgJsonPath) || {}).version || '0.0.0'; } catch (e) { /* ok */ }

      function resolveDestRoot() {
        if (opts.dir) return pathMod.resolve(opts.dir);
        if (opts.scope === 'user') return pathMod.join(os.homedir(), '.claude', 'plugins');
        return pathMod.join(process.cwd(), '.claude', 'plugins');
      }

      if (opts.status) {
        console.log(meta.name + ' install --status');
        var destRootSt = resolveDestRoot();
        var pluginDirSt = pathMod.join(destRootSt, meta.name);
        var installed = await emitter.readInstalledPluginVersion(pluginDirSt);
        if (installed) {
          var tag = installed === meta.version ? 'installed' : 'outdated';
          console.log('  claude:    ' + tag + ' v' + installed + (tag === 'outdated' ? ' (bin at v' + meta.version + ')' : '') + ' at ' + pluginDirSt);
        } else {
          console.log('  claude:    not installed at ' + pluginDirSt);
        }
        var codexConfigSt = pathMod.join(os.homedir(), '.codex', 'config.toml');
        if (fs.existsSync(codexConfigSt) && fs.readFileSync(codexConfigSt, 'utf8').indexOf('# frontmcp:codex-start:' + meta.name) !== -1) {
          console.log('  codex:     installed entry for ' + meta.name + ' in ' + codexConfigSt);
        } else {
          console.log('  codex:     not installed in ' + codexConfigSt);
        }
        return;
      }

      function buildSkills() {
        if (opts.skills === false || opts.onlyMcp) return [];
        var out = [];
        for (var i = 0; i < (meta.skills || []).length; i++) {
          var s = meta.skills[i];
          var resourceDirs = {};
          if (s.resourceDirs) {
            for (var k in s.resourceDirs) {
              if (Object.prototype.hasOwnProperty.call(s.resourceDirs, k)) {
                resourceDirs[k] = pathMod.join(SCRIPT_DIR, s.resourceDirs[k]);
              }
            }
          }
          out.push({
            name: s.name,
            description: s.description || (s.name + ' skill from ' + meta.name),
            tags: Array.isArray(s.tags) && s.tags.length > 0 ? s.tags : undefined,
            license: s.license || undefined,
            instructionFile: s.instructionFile ? pathMod.join(SCRIPT_DIR, s.instructionFile) : undefined,
            resourceDirs: Object.keys(resourceDirs).length > 0 ? resourceDirs : undefined,
          });
        }
        return out;
      }

      function buildCommands() {
        if (opts.commands === false || opts.onlyMcp) return [];
        return (meta.prompts || []).map(function(p) {
          return { name: p.name, description: p.description, arguments: p.arguments };
        });
      }

      for (var pi = 0; pi < providers.length; pi++) {
        var provider = providers[pi];
        if (provider === 'claude') {
          var destRoot = resolveDestRoot();
          var result = await emitter.emitClaudePlugin({
            destRoot: destRoot,
            name: meta.name,
            version: meta.version,
            description: meta.description,
            mcpCommand: opts.command || meta.mcpDefault.command,
            mcpArgs: meta.mcpDefault.args,
            envHints: Array.isArray(opts.env) ? opts.env : [],
            skills: buildSkills(),
            commands: buildCommands(),
            cliVersion: cliVersion,
            dryRun: opts.dryRun,
          });
          if (opts.dryRun) {
            console.log('[install:claude] dry-run plan');
            console.log('  pluginDir: ' + result.pluginDir);
            console.log('  filesWritten (planned):');
            for (var fwi = 0; fwi < result.filesWritten.length; fwi++) console.log('    + ' + result.filesWritten[fwi]);
          } else {
            console.log('✓ Wrote ' + result.pluginDir + '/ (' + (result.manifest.skills || []).length + ' skills, ' + ((result.manifest.commands || []).length) + ' commands, 1 MCP server)');
            console.log('  Restart Claude Code (or run /plugins reload) to pick up the plugin.');
          }
        } else if (provider === 'codex') {
          var codexConfig = pathMod.join(os.homedir(), '.codex', 'config.toml');
          var env = {};
          var envList = Array.isArray(opts.env) ? opts.env : [];
          for (var ei = 0; ei < envList.length; ei++) env[envList[ei]] = '${'$'}{' + envList[ei] + '}';
          var codexResult = await emitter.emitCodexEntry({
            configPath: codexConfig,
            name: meta.name,
            command: opts.command || meta.mcpDefault.command,
            args: meta.mcpDefault.args,
            env: env,
            dryRun: opts.dryRun,
          });
          if (opts.dryRun) {
            console.log('[install:codex] dry-run plan');
            console.log('  configPath: ' + codexConfig);
            console.log(codexResult.configContent);
          } else {
            console.log('✓ Updated ' + codexConfig + ' with [[mcp_servers]] entry for ' + meta.name);
          }
        } else {
          console.error('Unknown provider: ' + provider);
          process.exitCode = 1;
          return;
        }
      }
      return;
    }

    var installBase = opts.prefix || FRONTMCP_HOME;
    var appDir = pathMod.join(installBase, 'apps', ${JSON.stringify(appName)});
    var dirs = ['', '/data', '/sessions', '/credentials'].map(function(s) { return appDir + s; });

    console.log('Installing ${appName}...');
    dirs.forEach(function(d) { fs.mkdirSync(d, { recursive: true }); });

    // Copy bundle files and skill content
    var files = fs.readdirSync(SCRIPT_DIR).filter(function(f) {
      return f.endsWith('.js') || f.endsWith('.json') || f.endsWith('.md')${selfContained ? " || f.endsWith('-bin')" : ''};
    });
    files.forEach(function(f) {
      fs.copyFileSync(pathMod.join(SCRIPT_DIR, f), pathMod.join(appDir, f));
    });
    // Copy skill content directories (only those that exist in the build output)
    var entries = fs.readdirSync(SCRIPT_DIR, { withFileTypes: true });
    entries.forEach(function(ent) {
      if (ent.isDirectory()) {
        fs.cpSync(pathMod.join(SCRIPT_DIR, ent.name), pathMod.join(appDir, ent.name), { recursive: true });
      }
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

    // Set execute permission on the entry point
    var entryFile = pathMod.join(appDir, ${JSON.stringify(selfContained ? `${appName}-cli-bin` : `${appName}-cli.bundle.js`)});
    try { fs.chmodSync(entryFile, 0o755); } catch (_) { /* ok */ }

    // Create symlink
    var binDirs = opts.binDir ? [opts.binDir] : ['/usr/local/bin', pathMod.join(os.homedir(), '.local', 'bin')];
    var linked = false;
    for (var j = 0; j < binDirs.length && !linked; j++) {
      try {
        fs.mkdirSync(binDirs[j], { recursive: true });
        var linkPath = pathMod.join(binDirs[j], ${JSON.stringify(appName)});
        try { fs.unlinkSync(linkPath); } catch (_) { /* ok */ }
        fs.symlinkSync(entryFile, linkPath);
        console.log('  Symlinked: ' + linkPath);
        linked = true;
      } catch (_) { /* try next */ }
    }

    console.log('\\nInstalled. Run: ${appName} --help');
  });

program
  .command('uninstall')
  .description('Remove from ~/.frontmcp/, OR remove an IDE plugin (use -p)')
  .option('--prefix <path>', 'Installation prefix directory')
  .option('--bin-dir <path>', 'Directory where symlink was created')
  .option('-p, --provider <provider>', 'Remove plugin for provider: claude | codex (repeatable)', _frontmcpCollectArg, [])
  .option('--scope <scope>', 'Plugin scope when -p is set: project | user', 'project')
  .option('--dir <dir>', 'Override plugin destination root')
  .action(async function(opts) {
    var fs = require('fs');
    var pathMod = require('path');
    var os = require('os');

    // Issue #411 — when -p is set, route through the shared plugin-emitter
    // to remove the IDE plugin instead of the legacy ~/.frontmcp uninstall.
    var providers = Array.isArray(opts.provider) ? opts.provider : [];
    if (providers.length > 0) {
      var emitter = require('./plugin-emitter');
      var binMetaPath = pathMod.join(SCRIPT_DIR, 'bin-meta.json');
      var meta;
      try { meta = JSON.parse(fs.readFileSync(binMetaPath, 'utf8')); }
      catch (e) {
        console.error('Could not read bin-meta.json at ' + binMetaPath + '. Was the bin built with a recent frontmcp?');
        process.exit(1);
      }

      function resolveDestRoot() {
        if (opts.dir) return pathMod.resolve(opts.dir);
        if (opts.scope === 'user') return pathMod.join(os.homedir(), '.claude', 'plugins');
        return pathMod.join(process.cwd(), '.claude', 'plugins');
      }

      for (var pi = 0; pi < providers.length; pi++) {
        var provider = providers[pi];
        if (provider === 'claude') {
          var destRoot = resolveDestRoot();
          var result = await emitter.removeClaudePlugin({ destRoot: destRoot, name: meta.name });
          if (result.removed.length === 0) {
            console.log('  claude: nothing to remove at ' + result.pluginDir);
          } else {
            console.log('✓ Removed ' + result.removed.length + ' file(s) from ' + result.pluginDir);
          }
        } else if (provider === 'codex') {
          var codexConfig = pathMod.join(os.homedir(), '.codex', 'config.toml');
          var codexResult = await emitter.removeCodexEntry({ configPath: codexConfig, name: meta.name });
          if (codexResult.removed) {
            console.log('✓ Removed [[mcp_servers]] entry for ' + meta.name + ' from ' + codexConfig);
          } else {
            console.log('  codex: no entry for ' + meta.name + ' in ' + codexConfig);
          }
        } else {
          console.error('Unknown provider: ' + provider);
          process.exitCode = 1;
          return;
        }
      }
      return;
    }

    var uninstallBase = opts.prefix || FRONTMCP_HOME;
    var appDir = pathMod.join(uninstallBase, 'apps', ${JSON.stringify(appName)});

    // Remove credentials (if auth is enabled)
    if (typeof creds !== 'undefined') {
      var store = creds.createCredentialStore();
      var credSessions = await store.list();
      for (var i = 0; i < credSessions.length; i++) {
        await store.delete(credSessions[i]);
      }
    }

    // Remove symlink
    var binDirs = opts.binDir ? [opts.binDir] : ['/usr/local/bin', pathMod.join(os.homedir(), '.local', 'bin')];
    binDirs.forEach(function(d) {
      try { fs.unlinkSync(pathMod.join(d, ${JSON.stringify(appName)})); } catch (_) { /* ok */ }
    });

    // Remove app directory
    fs.rmSync(appDir, { recursive: true, force: true });
    console.log('Uninstalled ${appName}.');
  });`;
}

function generateDaemonCommands(appName: string, serverBundleFilename: string, selfContained?: boolean): string {
  return `var daemonCmd = program.command('daemon').description('Daemon management');

daemonCmd
  .command('start')
  .description('Start as a background daemon')
  .option('-p, --port <port>', 'Listen on a TCP port instead of a Unix socket', function(v) { return parseInt(v, 10); })
  .option('--idle-timeout <ms>', 'Auto-stop after idle period (ms, 0 to disable)', function(v) { return parseInt(v, 10); }, 300000)
  .action(async function(opts) {
    var { spawn } = require('child_process');
    var pathMod = require('path');
    var pidDir = pathMod.join(FRONTMCP_HOME, 'pids');
    var logDir = pathMod.join(FRONTMCP_HOME, 'logs');
    var socketDir = pathMod.join(FRONTMCP_HOME, 'sockets');
    fs.mkdirSync(pidDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });
    fs.mkdirSync(socketDir, { recursive: true });

    var usePort = !!opts.port;
    var socketPath = pathMod.join(socketDir, ${JSON.stringify(appName)} + '.sock');

    // Clean up stale socket file (only relevant in socket mode)
    if (!usePort) { try { fs.unlinkSync(socketPath); } catch (_) { /* ok */ } }

    // Check if already running
    var pidPath = pathMod.join(pidDir, ${JSON.stringify(appName)} + '.pid');
    try {
      var existing = JSON.parse(fs.readFileSync(pidPath, 'utf8'));
      process.kill(existing.pid, 0);
      console.log('Daemon already running (PID: ' + existing.pid + ').');
      return;
    } catch (_) { /* not running, proceed */ }

    var env = Object.assign({}, process.env, {
      FRONTMCP_DAEMON_IDLE_TIMEOUT: String(opts.idleTimeout)
    });
    if (usePort) {
      env.FRONTMCP_DAEMON_PORT = String(opts.port);
    } else {
      env.FRONTMCP_DAEMON_SOCKET = socketPath;
    }

    var logPath = pathMod.join(logDir, ${JSON.stringify(appName)} + '.log');
    var out = fs.openSync(logPath, 'a');
    var err = fs.openSync(logPath, 'a');

${selfContained ? `    // SEA mode: spawn the binary itself in daemon mode — all code is inlined
    env.__FRONTMCP_DAEMON_MODE = '1';
    var child = spawn(process.execPath, [], {
      detached: true,
      stdio: ['ignore', out, err],
      env: env
    });` : `    // Start the daemon via a small wrapper script
    // Always use absolute path for the server bundle (SCRIPT_DIR resolves to __dirname at runtime)
    var serverBundlePath = pathMod.join(SCRIPT_DIR, ${JSON.stringify(serverBundleFilename)});
    var daemonScript = 'require("reflect-metadata");' +
      'process.env.FRONTMCP_SCHEMA_EXTRACT="1";' +
      'var mod = require(' + JSON.stringify(serverBundlePath) + ');' +
      'delete process.env.FRONTMCP_SCHEMA_EXTRACT;' +
      'var sdk = require("@frontmcp/sdk");' +
      'var FrontMcpInstance = sdk.FrontMcpInstance || sdk.default.FrontMcpInstance;' +
      'var raw = mod.default || mod;' +
      ${'// If the export is a @FrontMcp-decorated class, extract config via Reflect metadata'}
      'var config = (typeof raw === "function" && typeof Reflect !== "undefined" && Reflect.getMetadata) ' +
      '  ? (Reflect.getMetadata("__frontmcp:config", raw) || raw) : raw;';

    if (usePort) {
      daemonScript +=
        'config = Object.assign({}, config, { http: Object.assign({}, config.http || {}, { port: ' + opts.port + ' }) });' +
        'process.env.PORT = ' + JSON.stringify(String(opts.port)) + ';' +
        'FrontMcpInstance.bootstrap(config)' +
        '.then(function() { console.log("Daemon listening on port ' + opts.port + '"); })' +
        '.catch(function(e) { console.error("Daemon failed:", e); process.exit(1); });';
    } else {
      daemonScript +=
        'FrontMcpInstance.runUnixSocket(Object.assign({}, config, { socketPath: ' + JSON.stringify(socketPath) + ' }))' +
        '.then(function() { console.log("Daemon listening on " + ' + JSON.stringify(socketPath) + '); })' +
        '.catch(function(e) { console.error("Daemon failed:", e); process.exit(1); });';
    }

    var child = spawn('node', ['-e', daemonScript], {
      detached: true,
      stdio: ['ignore', out, err],
      env: env
    });`}

    // Close inherited file descriptors in the parent — the child already has its own copy.
    fs.closeSync(out);
    fs.closeSync(err);

    var pidData = { pid: child.pid, startedAt: new Date().toISOString() };
    if (usePort) {
      pidData.port = opts.port;
    } else {
      pidData.socketPath = socketPath;
    }
    fs.writeFileSync(pidPath, JSON.stringify(pidData));
    child.unref();

    if (usePort) {
      // For port mode, wait briefly then check if process is still alive
      await new Promise(function(r) { setTimeout(r, 1000); });
      try {
        process.kill(child.pid, 0);
        console.log('Daemon started (PID: ' + child.pid + '). Port: ' + opts.port);
        console.log('Logs: ' + logPath);
      } catch (_) {
        console.log('Daemon failed to start. Check logs: ' + logPath);
      }
    } else {
      // Wait for socket file to appear (max 5s)
      var waited = 0;
      while (!fs.existsSync(socketPath) && waited < 5000) {
        await new Promise(function(r) { setTimeout(r, 100); });
        waited += 100;
      }

      if (fs.existsSync(socketPath)) {
        console.log('Daemon started (PID: ' + child.pid + '). Socket: ' + socketPath);
        console.log('Logs: ' + logPath);
      } else {
        console.log('Daemon started (PID: ' + child.pid + ') but socket not yet available.');
        console.log('Check logs: ' + logPath);
      }
    }
  });

daemonCmd
  .command('stop')
  .description('Stop the daemon')
  .action(function() {
    var pathMod = require('path');
    var pidPath = pathMod.join(FRONTMCP_HOME, 'pids', ${JSON.stringify(appName)} + '.pid');
    try {
      var data = JSON.parse(fs.readFileSync(pidPath, 'utf8'));
      process.kill(data.pid, 'SIGTERM');
      fs.unlinkSync(pidPath);
      // Clean up socket file
      if (data.socketPath) {
        try { fs.unlinkSync(data.socketPath); } catch (_) { /* ok */ }
      }
      console.log('Daemon stopped (PID: ' + data.pid + ').');
    } catch (e) {
      console.log('No running daemon found.');
    }
  });

daemonCmd
  .command('status')
  .description('Check daemon status')
  .action(function() {
    var pathMod = require('path');
    var pidPath = pathMod.join(FRONTMCP_HOME, 'pids', ${JSON.stringify(appName)} + '.pid');
    try {
      var data = JSON.parse(fs.readFileSync(pidPath, 'utf8'));
      try {
        process.kill(data.pid, 0);
        var listenInfo = data.port ? ', port: ' + data.port : (data.socketPath && fs.existsSync(data.socketPath) ? ', socket: active' : '');
        console.log('Running (PID: ' + data.pid + ', started: ' + data.startedAt + listenInfo + ')');
      } catch (_) {
        console.log('Not running (stale PID file).');
        fs.unlinkSync(pidPath);
      }
    } catch (_) { console.log('Not running.'); }
  });

daemonCmd
  .command('logs')
  .description('Tail daemon logs')
  .option('-n, --lines <n>', 'Number of lines', function(v) { return parseInt(v, 10); }, 50)
  .action(function(opts) {
    var pathMod = require('path');
    var logPath = pathMod.join(FRONTMCP_HOME, 'logs', ${JSON.stringify(appName)} + '.log');
    try {
      var content = fs.readFileSync(logPath, 'utf8');
      var lines = content.split('\\n');
      var start = Math.max(0, lines.length - opts.lines);
      console.log(lines.slice(start).join('\\n'));
    } catch (_) { console.log('No logs found.'); }
  });`;
}

function generateFooter(): string {
  return `program.on('command:*', function(args) {
  console.error('Unknown command: ' + args[0]);
  process.exitCode = 1;
});
program.parseAsync(process.argv).then(async function() {
  // Long-running commands (serve) set _isLongRunning to keep the event loop alive.
  // Short-lived commands close the client and exit explicitly to avoid hanging
  // on unclosed handles (file loggers, in-memory transport, etc.).
  if (_isLongRunning) return;
  await closeClient();
  // Defer process.exit() by one event-loop tick so native addon destructors
  // (ONNX runtime, etc.) can release mutexes before V8 tears down.
  setImmediate(function() { process.exit(process.exitCode || 0); });
}).catch(async function(err) {
  // Commander errors come through exitOverride with the code already set on
  // process.exitCode. They are user-facing usage errors, not fatals — don't
  // re-print "Fatal:" / "Unknown error" for them.
  var isCommanderErr = err && typeof err.code === 'string' && err.code.indexOf('commander.') === 0;
  if (!isCommanderErr) {
    console.error('Fatal:', err.message || err);
  }
  await closeClient();
  // Use the exit code set by exitOverride (which can legitimately be 0 for
  // --help / --version). Only fall back to 1 when no code was set.
  setImmediate(function() {
    var code = (typeof process.exitCode === 'number') ? process.exitCode : 1;
    process.exit(code);
  });
});`;
}

/**
 * Extract {param} placeholders from a URI template string.
 */
export function extractTemplateParams(uriTemplate: string): string[] {
  const matches = uriTemplate.match(/\{([^}]+)\}/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1, -1));
}

function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
