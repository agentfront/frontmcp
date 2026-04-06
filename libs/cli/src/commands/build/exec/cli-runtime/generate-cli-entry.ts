/**
 * Generates the CLI entry point TypeScript/JavaScript source code.
 * This creates a commander.js-based CLI where each MCP tool is a subcommand.
 */

import { CliConfig, OAuthConfig } from '../config';
import { ExtractedSchema, ExtractedTool, ExtractedPrompt, ExtractedResourceTemplate, ExtractedCapabilities, ExtractedJob, SYSTEM_TOOL_NAMES } from './schema-extractor';
import { schemaToCommander, generateOptionCode, camelToKebab } from './schema-to-commander';

export const RESERVED_COMMANDS = new Set([
  'resource', 'template', 'prompt', 'subscribe',
  'login', 'logout', 'connect', 'serve', 'daemon',
  'doctor', 'install', 'uninstall', 'sessions', 'help', 'version',
  'skills', 'job', 'workflow',
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
  var _dMod = require(${JSON.stringify('../' + serverBundleFilename)});
  var _dSdk = require('@frontmcp/sdk');
  var _FMI = _dSdk.FrontMcpInstance || _dSdk.default.FrontMcpInstance;
  var _raw = _dMod.default || _dMod;
  var _cfg = (typeof _raw === 'function' && typeof Reflect !== 'undefined' && Reflect.getMetadata)
    ? (Reflect.getMetadata('__frontmcp:config', _raw) || _raw) : _raw;
  var _sp = process.env.FRONTMCP_DAEMON_SOCKET;
  _FMI.runUnixSocket(Object.assign({}, _cfg, { socketPath: _sp }))
    .then(function() { console.log('Daemon listening on ' + _sp); })
    .catch(function(e) { console.error('Daemon failed:', e); process.exit(1); });
  return;
}
` : ''}
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

var program = new Command();
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
    } catch (err) {
      var meta = err && err._meta ? err._meta : (err && err.data && err.data._meta ? err.data._meta : null);
      if (meta && meta.authorization_required) {
        console.error('Authorization required' + (meta.app ? ' for ' + meta.app : ''));
        if (meta.auth_url) console.error('Authorize at: ' + meta.auth_url);
        console.error('Or run: ' + ${JSON.stringify(appName)} + ' login');
      } else {
        console.error('Error:', err.message || err);
      }
      process.exitCode = 1;
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
      console.error('Error:', err.message || err);
      process.exitCode = 1;
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
      console.error('Error:', err.message || err);
      process.exitCode = 1;
    }
  });

${subcommands.join('\n\n')}`;
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
      console.error('Error:', err.message || err);
      process.exitCode = 1;
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
      console.error('Error:', err.message || err);
      process.exitCode = 1;
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
      console.error('Error:', err.message || err);
      process.exitCode = 1;
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
      console.error('Error:', err.message || err);
      process.exitCode = 1;
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
      console.error('Error:', err.message || err);
      process.exitCode = 1;
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
      console.error('Error:', err.message || err);
      process.exitCode = 1;
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
      console.error('Error:', err.message || err);
      process.exitCode = 1;
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
      console.error('Error:', err.message || err);
      process.exitCode = 1;
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
      console.error('Error:', err.message || err);
      process.exitCode = 1;
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
      console.error('Error:', err.message || err);
      process.exitCode = 1;
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
      console.error('Error:', err.message || err);
      process.exitCode = 1;
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
      console.error('Error:', err.message || err);
      process.exitCode = 1;
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
      console.error('Error:', err.message || err);
      process.exitCode = 1;
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
      console.error('Error:', err.message || err);
      process.exitCode = 1;
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
      console.error('Error:', err.message || err);
      process.exitCode = 1;
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
  .description('Start the HTTP/SSE server')
  .option('-p, --port <port>', 'Port number', function(v) { return parseInt(v, 10); })
  .action(async function(opts) {
    var mod = ${requireExpr};
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

  return `program
  .command('install')
  .description('Install to ~/.frontmcp/ and set up dependencies')
  .option('--prefix <path>', 'Installation prefix directory')
  .option('--bin-dir <path>', 'Directory for symlink (default: ~/.local/bin or /usr/local/bin)')
  .action(async function(opts) {
    var fs = require('fs');
    var pathMod = require('path');
    var os = require('os');
    var exec = require('child_process').execSync;
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
  .description('Remove from ~/.frontmcp/ and clean up')
  .option('--prefix <path>', 'Installation prefix directory')
  .option('--bin-dir <path>', 'Directory where symlink was created')
  .action(async function(opts) {
    var fs = require('fs');
    var pathMod = require('path');
    var os = require('os');
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
  .description('Start as a background daemon (Unix socket)')
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

    var socketPath = pathMod.join(socketDir, ${JSON.stringify(appName)} + '.sock');

    // Clean up stale socket file
    try { fs.unlinkSync(socketPath); } catch (_) { /* ok */ }

    // Check if already running
    var pidPath = pathMod.join(pidDir, ${JSON.stringify(appName)} + '.pid');
    try {
      var existing = JSON.parse(fs.readFileSync(pidPath, 'utf8'));
      process.kill(existing.pid, 0);
      console.log('Daemon already running (PID: ' + existing.pid + ').');
      return;
    } catch (_) { /* not running, proceed */ }

    var env = Object.assign({}, process.env, {
      FRONTMCP_DAEMON_SOCKET: socketPath,
      FRONTMCP_DAEMON_IDLE_TIMEOUT: String(opts.idleTimeout)
    });

    var logPath = pathMod.join(logDir, ${JSON.stringify(appName)} + '.log');
    var out = fs.openSync(logPath, 'a');
    var err = fs.openSync(logPath, 'a');

${selfContained ? `    // SEA mode: spawn the binary itself in daemon mode — all code is inlined
    env.__FRONTMCP_DAEMON_MODE = '1';
    var child = spawn(process.execPath, [], {
      detached: true,
      stdio: ['ignore', out, err],
      env: env
    });` : `    // Start the daemon using runUnixSocket via a small wrapper script
    // Always use absolute path for the server bundle (SCRIPT_DIR resolves to __dirname at runtime)
    var serverBundlePath = pathMod.join(SCRIPT_DIR, ${JSON.stringify(serverBundleFilename)});
    var daemonScript = 'require("reflect-metadata");' +
      'var mod = require(' + JSON.stringify(serverBundlePath) + ');' +
      'var sdk = require("@frontmcp/sdk");' +
      'var FrontMcpInstance = sdk.FrontMcpInstance || sdk.default.FrontMcpInstance;' +
      'var raw = mod.default || mod;' +
      ${'// If the export is a @FrontMcp-decorated class, extract config via Reflect metadata'}
      'var config = (typeof raw === "function" && typeof Reflect !== "undefined" && Reflect.getMetadata) ' +
      '  ? (Reflect.getMetadata("__frontmcp:config", raw) || raw) : raw;' +
      'FrontMcpInstance.runUnixSocket(Object.assign({}, config, { socketPath: ' + JSON.stringify(socketPath) + ' }))' +
      '.then(function() { console.log("Daemon listening on " + ' + JSON.stringify(socketPath) + '); })' +
      '.catch(function(e) { console.error("Daemon failed:", e); process.exit(1); });';

    var child = spawn('node', ['-e', daemonScript], {
      detached: true,
      stdio: ['ignore', out, err],
      env: env
    });`}

    // Close inherited file descriptors in the parent — the child already has its own copy.
    fs.closeSync(out);
    fs.closeSync(err);

    fs.writeFileSync(pidPath, JSON.stringify({
      pid: child.pid,
      socketPath: socketPath,
      startedAt: new Date().toISOString()
    }));
    child.unref();

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
        var socketStatus = data.socketPath && fs.existsSync(data.socketPath) ? ', socket: active' : '';
        console.log('Running (PID: ' + data.pid + ', started: ' + data.startedAt + socketStatus + ')');
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
  // Close the client to release file descriptors and in-memory transport.
  // Long-running commands (serve, subscribe) never reach here because they
  // block the event loop, so process.exit() only fires for short-lived commands.
  await closeClient();
  process.exit(process.exitCode || 0);
}).catch(async function(err) {
  console.error('Fatal:', err.message || err);
  await closeClient();
  process.exit(1);
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
