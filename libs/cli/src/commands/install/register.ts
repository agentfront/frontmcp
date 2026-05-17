/**
 * Issue #411 — registers the dev-tool side `frontmcp plugin` command tree
 * (uses `plugin` as the noun because `install` is already taken by the
 * npm-package install command at `package/register.ts`).
 *
 * Subcommands:
 *   frontmcp plugin install   — emit a Claude Code plugin folder + Codex entry
 *   frontmcp plugin uninstall — remove what `install` wrote
 *   frontmcp plugin status    — report install state per provider
 *
 * The per-bin equivalent (auto-included in every built CLI) extends the
 * existing `<bin> install` with `-p claude|codex` and shares the same
 * emitter under `cli-runtime/plugin-emitter.ts`.
 */

import { type Command } from 'commander';

export function registerInstallCommands(program: Command): void {
  const plugin = program
    .command('plugin')
    .description('Install the current FrontMCP server as a plugin for an AI tool');

  plugin
    .command('install')
    .description('Emit a Claude Code plugin folder and/or Codex mcp_servers entry from the current project')
    .option('--claude', 'Emit a Claude Code plugin into <scope>/.claude/plugins/<name>/')
    .option('--codex', 'Emit a Codex mcp_servers entry into ~/.codex/config.toml')
    .option('--scope <scope>', 'project | user (default: project)', 'project')
    .option('--no-skills', 'Skip the skills/ subtree')
    .option('--no-commands', 'Skip the commands/ subtree')
    .option('--only-mcp', 'Skip the plugin folder; just register the MCP server')
    .option('--command <cmd>', 'Override the MCP server invocation in the plugin manifest')
    .option(
      '--env <name>',
      'Env-var placeholder to surface on the plugin (repeatable)',
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option('--dir <dir>', 'Override the plugin destination root')
    .option('--dry-run', 'Print the planned tree and exit without writing')
    .action(async (opts: Record<string, unknown>) => {
      // Map flag name to the legacy internal option name expected by the runner.
      const mappedOpts = { ...opts, claudePlugin: opts['claude'] === true };
      const { runInstallCurrentProject } = await import('./install-claude-plugin.js');
      await runInstallCurrentProject(mappedOpts);
    });

  plugin
    .command('uninstall')
    .description('Remove what `frontmcp plugin install` previously wrote')
    .option('--claude', 'Remove the Claude Code plugin folder')
    .option('--codex', 'Remove the Codex mcp_servers entry')
    .option('--scope <scope>', 'project | user (default: project)', 'project')
    .option('--dir <dir>', 'Override the plugin destination root')
    .action(async (opts: Record<string, unknown>) => {
      const mappedOpts = { ...opts, claudePlugin: opts['claude'] === true };
      const { runUninstallCurrentProject } = await import('./install-claude-plugin.js');
      await runUninstallCurrentProject(mappedOpts);
    });

  plugin
    .command('status')
    .description('Report install state per provider')
    .option('--claude', 'Check Claude Code plugin state')
    .option('--codex', 'Check Codex mcp_servers entry')
    .option('--scope <scope>', 'project | user (default: project)', 'project')
    .option('--dir <dir>', 'Override the plugin destination root')
    .action(async (opts: Record<string, unknown>) => {
      const mappedOpts = { ...opts, claudePlugin: opts['claude'] === true, status: true };
      const { runInstallCurrentProject } = await import('./install-claude-plugin.js');
      await runInstallCurrentProject(mappedOpts);
    });
}
