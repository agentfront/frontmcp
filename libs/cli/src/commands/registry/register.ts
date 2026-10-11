import { Argument, Option, type Command } from 'commander';

import { c } from '../../core/colors';
import type { ServerStatus } from './api';
import type { AuthMethod } from './login';

interface LoginFlags {
  auth: AuthMethod;
  domain?: string;
  keyFile?: string;
  registry?: string;
  entry?: string;
}

export function registerRegistryCommands(program: Command): void {
  const registry = program
    .command('registry')
    .description('Publish the server to the MCP Registry (registry.modelcontextprotocol.io)');
  const configPath = () => (program.opts() as { config?: string }).config;

  registry
    .command('keygen')
    .description('Create the Ed25519 key that proves your domain to the MCP Registry')
    .option('-o, --out <file>', 'Where to write the private key (default: ~/.frontmcp/keys/mcp-registry.key)')
    .option('--force', 'Replace an existing key file')
    .action(async (options: { out?: string; force?: boolean }) => {
      await runRegistryCommand(async () => {
        const { generateRegistryKey } = await import('./keygen.js');
        await generateRegistryKey(options);
      });
    });

  addLoginOptions(
    registry.command('publish').description('Build server.json, validate it, and publish it to the MCP Registry'),
  )
    .option('--file <path>', 'Publish this server.json as is instead of building one from the project')
    .option('--url <url>', 'Streamable HTTP URL of the deployed server (remotes[0]; overrides registry.url)')
    .option('--dry-run', 'Print server.json and the validation result, without logging in or publishing')
    .action(async (options: LoginFlags & { file?: string; url?: string; dryRun?: boolean }) => {
      await runRegistryCommand(async () => {
        const { publishToRegistry } = await import('./publish.js');
        await publishToRegistry({ ...options, configPath: configPath() });
      });
    });

  addLoginOptions(registry.command('status').description('Mark the server active, deprecated, or deleted'))
    .addArgument(new Argument('<status>', 'New status').choices(['active', 'deprecated', 'deleted']))
    .option('--server-version <version>', 'The version to change')
    .option('--all-versions', 'Change every version of the server')
    .option('--message <text>', 'Reason shown with deprecated or deleted (at most 500 characters)')
    .option('--name <name>', 'Server name (default: registry.name in @FrontMcp())')
    .action(
      async (
        status: ServerStatus,
        options: LoginFlags & { serverVersion?: string; allVersions?: boolean; message?: string; name?: string },
      ) => {
        await runRegistryCommand(async () => {
          const { setServerStatus } = await import('./status.js');
          await setServerStatus({ ...options, status, configPath: configPath() });
        });
      },
    );
}

function addLoginOptions(command: Command): Command {
  return command
    .addOption(
      new Option('--auth <method>', 'How to prove the namespace (github-oidc: GitHub Actions only)')
        .choices(['http', 'dns', 'github-oidc'])
        .default('http'),
    )
    .option(
      '--domain <domain>',
      'Domain that serves the proof (default: the namespace reversed, com.example -> example.com)',
    )
    .option('--key-file <path>', 'Ed25519 private key, hex seed or PEM (default: env MCP_REGISTRY_PRIVATE_KEY)')
    .option(
      '--registry <url>',
      'Registry base URL (default: registry.registryUrl, else https://registry.modelcontextprotocol.io)',
    )
    .option('-e, --entry <path>', 'Entry file with the @FrontMcp() class (default: auto-detected)');
}

async function runRegistryCommand(command: () => Promise<void>): Promise<void> {
  const { RegistryError } = await import('./errors.js');
  try {
    await command();
  } catch (error) {
    if (!(error instanceof RegistryError)) throw error;
    console.error(c('red', error.message));
    process.exitCode = 1;
  }
}
