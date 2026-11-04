/**
 * The generated CLI's Skilled OpenAPI commands: search, load, read and run a server's bundle skills through the
 * plugin's meta-tools. Compiled with the CLI, then bundled into each generated CLI whose server uses the plugin.
 */
import type { Command } from 'commander';

import { readFile } from '@frontmcp/utils';

/** The Skilled OpenAPI plugin's meta-tools, by the command each one serves. */
export const SKILLED_OPENAPI_TOOLS = {
  search: 'search_skill',
  load: 'load_skill',
  execute: 'execute_action',
  run: 'run_workflow',
} as const;

type Verb = keyof typeof SKILLED_OPENAPI_TOOLS;

/** The top-level name of each command, on a CLI whose only tools are the plugin's, with the names it also answers to. */
export const TOP_LEVEL_SKILL_COMMANDS: Record<Verb, { name: string; aliases: string[] }> = {
  search: { name: 'search_skill', aliases: ['search-skill'] },
  load: { name: 'load_skill', aliases: ['load-skill'] },
  execute: { name: 'execute', aliases: ['execute_action', 'execute-action'] },
  run: { name: 'run_workflow', aliases: ['run-workflow'] },
};

interface ToolCallResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

interface ResourceReadResult {
  contents?: Array<{ text?: string }>;
}

/** The calls these commands make, which the CLI's in-process and daemon clients both serve. */
export interface SkilledClient {
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
  readResource(uri: string): Promise<ResourceReadResult>;
}

export interface SkilledCommandsOptions {
  getClient: () => Promise<SkilledClient>;
  /** The plugin's meta-tools the CLI offers: a command whose tool is left out isn't added. */
  toolNames: readonly string[];
  /** Also add the commands at the top level: for a server whose only tools are the plugin's. */
  topLevel: boolean;
  /** Where `-` reads from: standard input by default. */
  stdin?: NodeJS.ReadableStream;
}

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  examples?: unknown[];
}

interface SkillMatch {
  skillId: string;
  name: string;
  description: string;
  score: number;
}

interface SkillAction {
  actionId: string;
  summary: string;
  inputJsonSchema: JsonSchema;
}

interface LoadedSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  actions?: SkillAction[];
}

interface LoadSkillResult {
  skill: LoadedSkill;
  warning?: string;
}

type LoadSkillOutput = Partial<LoadSkillResult> & { skills?: LoadSkillResult[] };

interface SkillIndex {
  skills?: Array<{ type?: string; name?: string; description?: string }>;
}

/** Where a command is added: its name, the names it also answers to, and whether it takes the 1.11.0 flags. */
interface Placement {
  name: string;
  aliases: string[];
  acceptsLegacyFlags: boolean;
}

/** A mistake on the command line, which exits 2. */
class UsageError extends Error {}

interface CommandContext {
  program: Command;
  options: SkilledCommandsOptions;
  /** The command line that runs a verb, for the hints a command prints. */
  commandLine: (verb: Verb) => string;
}

/** Add the Skilled OpenAPI commands: always under `skills`, and also at the top level when `topLevel` is set. */
export function registerSkilledCommands(program: Command, options: SkilledCommandsOptions): void {
  const offered = (Object.keys(SKILLED_OPENAPI_TOOLS) as Verb[]).filter((verb) =>
    options.toolNames.includes(SKILLED_OPENAPI_TOOLS[verb]),
  );
  const context: CommandContext = {
    program,
    options,
    commandLine: (verb) =>
      options.topLevel
        ? `${program.name()} ${TOP_LEVEL_SKILL_COMMANDS[verb].name}`
        : `${program.name()} skills ${verb}`,
  };

  if (options.topLevel) {
    for (const verb of offered) {
      ADD_COMMAND[verb](program, { ...TOP_LEVEL_SKILL_COMMANDS[verb], acceptsLegacyFlags: true }, context);
    }
  }

  const group = program
    .command('skills')
    .description(`Find, load and run skills: ${[...offered, 'read', 'list'].join(', ')}`);
  group.addHelpText('after', `\nThe skills you can use: ${program.name()} skills list`);
  for (const verb of offered) {
    ADD_COMMAND[verb](group, { name: verb, aliases: [], acceptsLegacyFlags: false }, context);
  }
  addReadCommand(group, context);
  addListCommand(group, context);
}

const ADD_COMMAND: Record<Verb, (parent: Command, placement: Placement, context: CommandContext) => void> = {
  search: addSearchCommand,
  load: addLoadCommand,
  execute: addExecuteCommand,
  run: addRunCommand,
};

function addSearchCommand(parent: Command, placement: Placement, context: CommandContext): void {
  const command = parent
    .command(`${placement.name} [query...]`)
    .aliases(placement.aliases)
    .description('Find the skills for what you want to do')
    .option('--limit <n>', 'At most this many skills (default 20)')
    .option('--tags <tags>', 'Only skills with these tags, comma-separated')
    .option('--not-query <text>', 'Rank the skills matching this lower');
  if (placement.acceptsLegacyFlags) command.addOption(command.createOption('--query <text>').hideHelp());

  command.action((words: string[], flags: { limit?: string; tags?: string; notQuery?: string; query?: string }) =>
    runCommand(async () => {
      const query = words.join(' ') || flags.query;
      if (!query) throw new UsageError(`say what you want to do, as in: ${context.commandLine('search')} "refund an invoice"`);
      const args: Record<string, unknown> = { query };
      if (flags.limit !== undefined) args['limit'] = positiveInteger(flags.limit, '--limit');
      if (flags.tags !== undefined) args['tags'] = commaSeparated(flags.tags);
      if (flags.notQuery !== undefined) args['notQuery'] = flags.notQuery;
      await callAndReport(context, SKILLED_OPENAPI_TOOLS.search, args, (output) =>
        renderSkillMatches(output as { skills?: SkillMatch[] }, context.commandLine('load')),
      );
    }),
  );
}

function addLoadCommand(parent: Command, placement: Placement, context: CommandContext): void {
  const skillsArgument = placement.acceptsLegacyFlags ? '[skills...]' : '<skills...>';
  const command = parent
    .command(`${placement.name} ${skillsArgument}`)
    .aliases(placement.aliases)
    .description("Show skills' instructions, and their actions with a ready command for each");
  if (placement.acceptsLegacyFlags) command.addOption(command.createOption('--skill-id <id>').hideHelp());

  command.action((names: string[], flags: { skillId?: string }) =>
    runCommand(async () => {
      const skillIds = flags.skillId === undefined ? names : [...names, flags.skillId];
      if (skillIds.length === 0) throw new UsageError(`name a skill, as in: ${context.commandLine('load')} invoices`);
      const args = skillIds.length === 1 ? { skillId: skillIds[0] } : { skillIds };
      await callAndReport(context, SKILLED_OPENAPI_TOOLS.load, args, (output) =>
        renderLoadedSkills(output as LoadSkillOutput, context.commandLine('execute')),
      );
    }),
  );
}

function addExecuteCommand(parent: Command, placement: Placement, context: CommandContext): void {
  parent
    .command(`${placement.name} <actionId>`)
    .aliases(placement.aliases)
    .description('Run one action of a skill, with its input as JSON (a destructive one asks first; --yes confirms)')
    .option('--input <json>', "The action's input as a JSON object, or - to read it from standard input")
    .option('--input-file <path>', "Read the action's input from a JSON file")
    .action((actionId: string, flags: { input?: string; inputFile?: string }) =>
      runCommand(async () => {
        const args: Record<string, unknown> = { actionId };
        const input = await actionInput(flags, context.options);
        if (input !== undefined) args['input'] = input;
        await callAndReport(context, SKILLED_OPENAPI_TOOLS.execute, args, renderActionData);
      }),
    );
}

function addRunCommand(parent: Command, placement: Placement, context: CommandContext): void {
  const command = parent
    .command(`${placement.name} [script]`)
    .aliases(placement.aliases)
    .description('Run a workflow script that chains actions: the script, --file, or - for standard input')
    .option('--file <path>', 'Read the script from a file');
  if (placement.acceptsLegacyFlags) command.addOption(command.createOption('--script <source>').hideHelp());

  command.action((scriptArgument: string | undefined, flags: { file?: string; script?: string }) =>
    runCommand(async () => {
      const script = await workflowScript(scriptArgument, flags, context);
      await callAndReport(context, SKILLED_OPENAPI_TOOLS.run, { script }, renderWorkflowValue);
    }),
  );
}

function addReadCommand(group: Command, context: CommandContext): void {
  group
    .command('read <skill>')
    .description("Show a skill's SKILL.md, by its name or id")
    .action((skill: string) =>
      runCommand(async () => {
        const skillPath = skill.split('/').map(encodeURIComponent).join('/');
        const result = await (await context.options.getClient()).readResource(`skill://${skillPath}/SKILL.md`);
        if (outputMode(context.program) === 'json') console.log(JSON.stringify(result, null, 2));
        else console.log(resourceText(result));
      }),
    );
}

function addListCommand(group: Command, context: CommandContext): void {
  group
    .command('list')
    .description('List the skills you can use')
    .action(() =>
      runCommand(async () => {
        const result = await (await context.options.getClient()).readResource('skill://index.json');
        const index = JSON.parse(resourceText(result)) as SkillIndex;
        if (outputMode(context.program) === 'json') {
          console.log(JSON.stringify(index, null, 2));
          return;
        }
        const skills = (index.skills ?? []).filter((entry) => entry.type === 'skill-md');
        if (skills.length === 0) {
          console.log('No skills found.');
          return;
        }
        console.log(skills.map((skill) => `${skill.name}\n  ${skill.description ?? ''}`).join('\n\n'));
        console.log(`\nLoad one: ${context.commandLine('load')} <name>`);
      }),
    );
}

async function runCommand(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}

/** Call the tool and print its answer: the structured content with `--output json`, else the text the tool's answer reads as. */
async function callAndReport(
  context: CommandContext,
  toolName: string,
  args: Record<string, unknown>,
  renderText: (output: unknown, result: ToolCallResult) => string | undefined,
): Promise<void> {
  const result = await (await context.options.getClient()).callTool(toolName, args);
  const json = outputMode(context.program) === 'json';
  if (json) console.log(JSON.stringify(result.structuredContent ?? result, null, 2));
  if (result.isError) {
    console.error(`Error: ${toolErrorText(result)}`);
    process.exitCode = result._meta?.['code'] === 'INVALID_INPUT' ? 2 : 1;
    return;
  }
  const text = json ? undefined : renderText(result.structuredContent ?? {}, result);
  if (text !== undefined) console.log(text);
}

function outputMode(program: Command): 'text' | 'json' {
  return program.opts()['output'] === 'json' ? 'json' : 'text';
}

function textOf(result: ToolCallResult): string {
  return (result.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

function toolErrorText(result: ToolCallResult): string {
  const error = result.structuredContent?.['error'];
  return typeof error === 'string' ? error : textOf(result) || 'the call failed';
}

function resourceText(result: ResourceReadResult): string {
  return (result.contents ?? []).map((content) => content.text ?? '').join('\n');
}

function positiveInteger(value: string, flag: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new UsageError(`${flag} takes a positive whole number, not "${value}"`);
  return number;
}

function commaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function readStandardInput(options: SkilledCommandsOptions): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of options.stdin ?? process.stdin) chunks.push(chunk.toString());
  return chunks.join('');
}

/** Read a file, or standard input for `-`. */
async function readSource(path: string, options: SkilledCommandsOptions): Promise<string> {
  if (path === '-') return readStandardInput(options);
  try {
    return await readFile(path);
  } catch (error) {
    throw new UsageError(`can't read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function actionInput(
  flags: { input?: string; inputFile?: string },
  options: SkilledCommandsOptions,
): Promise<Record<string, unknown> | undefined> {
  if (flags.input !== undefined && flags.inputFile !== undefined) {
    throw new UsageError('pass the input with --input or --input-file, not both');
  }
  if (flags.inputFile !== undefined) return jsonObject(await readSource(flags.inputFile, options), flags.inputFile);
  if (flags.input === '-') return jsonObject(await readStandardInput(options), 'standard input');
  return flags.input === undefined ? undefined : jsonObject(flags.input, '--input');
}

function jsonObject(text: string, source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${source} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new UsageError(`${source} must be a JSON object, such as '{"id":"INV-1001"}'`);
  }
  return parsed as Record<string, unknown>;
}

async function workflowScript(
  scriptArgument: string | undefined,
  flags: { file?: string; script?: string },
  context: CommandContext,
): Promise<string> {
  const sources = [scriptArgument, flags.file, flags.script].filter((source): source is string => source !== undefined);
  if (sources.length !== 1) {
    throw new UsageError(
      `give the script once: as an argument, with --file <path>, or - for standard input, as in: ` +
        `${context.commandLine('run')} --file refund.js`,
    );
  }
  if (scriptArgument === '-') return readStandardInput(context.options);
  return flags.file === undefined ? sources[0] : readSource(flags.file, context.options);
}

function renderSkillMatches(output: { skills?: SkillMatch[] }, loadCommand: string): string {
  const skills = output.skills ?? [];
  if (skills.length === 0) return 'No skills found.';
  const matches = skills.map(
    (skill) => `${skill.name} (${skill.skillId})  score ${skill.score.toFixed(2)}\n  ${skill.description}`,
  );
  return `${matches.join('\n\n')}\n\nLoad one: ${loadCommand} <skillId>`;
}

function renderLoadedSkills(output: LoadSkillOutput, executeCommand: string): string {
  const results = output.skills ?? (output.skill ? [{ skill: output.skill, warning: output.warning }] : []);
  return results.map((result) => renderLoadedSkill(result, executeCommand)).join('\n\n');
}

function renderLoadedSkill({ skill, warning }: LoadSkillResult, executeCommand: string): string {
  const lines = [`${skill.name} (${skill.id})`, skill.description];
  if (warning) lines.push(`Warning: ${warning}`);
  lines.push('', skill.instructions);
  const actions = skill.actions ?? [];
  if (actions.length > 0) {
    lines.push('', `Actions (${actions.length}):`);
    for (const action of actions) lines.push('', ...renderAction(action, executeCommand));
  }
  return lines.join('\n');
}

function renderAction(action: SkillAction, executeCommand: string): string[] {
  const schema = action.inputJsonSchema;
  const example = exampleObject(schema);
  const inputFlag = Object.keys(example).length > 0 ? ` --input ${shellQuoted(JSON.stringify(example))}` : '';
  const lines = [`  ${action.actionId}: ${action.summary}`, `    ${executeCommand} ${action.actionId}${inputFlag}`];
  const required = schema.required ?? [];
  const optional = Object.keys(schema.properties ?? {}).filter((name) => !required.includes(name));
  if (optional.length > 0) lines.push(`    optional input: ${optional.join(', ')}`);
  return lines;
}

/** An input with each required field, set to its example, default or first allowed value, else a placeholder. */
function exampleObject(schema: JsonSchema): Record<string, unknown> {
  const properties = schema.properties ?? {};
  const required = (schema.required ?? []).filter((name) => properties[name] !== undefined);
  return Object.fromEntries(required.map((name) => [name, exampleValue(name, properties[name])]));
}

function exampleValue(name: string, schema: JsonSchema): unknown {
  if (schema.examples && schema.examples.length > 0) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type.find((candidate) => candidate !== 'null') : schema.type;
  switch (type) {
    case 'object':
      return exampleObject(schema);
    case 'array':
      return [];
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      return `<${name}>`;
  }
}

function shellQuoted(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function renderActionData(_output: unknown, result: ToolCallResult): string {
  const text = textOf(result);
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function renderWorkflowValue(output: unknown): string | undefined {
  const { value } = output as { value?: unknown };
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
