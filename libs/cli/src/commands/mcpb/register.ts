import type { Command } from 'commander';

export function registerMcpbCommands(program: Command): void {
  const mcpb = program.command('mcpb').description('Manage MCPB (MCP Bundle) archives');

  mcpb
    .command('validate <path>')
    .description('Validate a .mcpb archive against the MCPB v0.3 specification')
    .action(async (archivePath: string) => {
      const { runValidate } = await import('./validate.js');
      await runValidate(archivePath);
    });
}
