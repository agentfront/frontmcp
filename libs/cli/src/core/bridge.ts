import { DeploymentAdapter, PackageManagerOption, ParsedArgs, RedisSetupOption } from './args';

/**
 * Convert commander's parsed command name, positional arguments, and options
 * into the legacy {@link ParsedArgs} shape expected by existing handlers.
 *
 * This is a Phase-1 bridge — it will be removed once each handler accepts
 * its own typed options interface (Phase 2).
 */
export function toParsedArgs(
  commandName: string,
  positionalArgs: string[],
  options: Record<string, unknown>,
): ParsedArgs {
  const out: ParsedArgs = { _: [commandName, ...positionalArgs] };

  // General
  if (options['outDir'] !== undefined) out.outDir = options['outDir'] as string;
  if (options['entry'] !== undefined) out.entry = options['entry'] as string;
  if (options['adapter'] !== undefined) out.adapter = options['adapter'] as DeploymentAdapter;

  // Build
  if (options['exec'] !== undefined) out.exec = options['exec'] as boolean;
  if (options['cli'] !== undefined) out.cli = options['cli'] as boolean;

  // Create
  if (options['yes'] !== undefined) out.yes = options['yes'] as boolean;
  if (options['target'] !== undefined) out.target = options['target'] as DeploymentAdapter;
  if (options['redis'] !== undefined) out.redis = options['redis'] as RedisSetupOption;
  if (options['cicd'] !== undefined) out.cicd = options['cicd'] as boolean;
  if (options['pm'] !== undefined) out.pm = options['pm'] as PackageManagerOption;
  if (options['nx'] !== undefined) out.nx = options['nx'] as boolean;

  // Test
  if (options['runInBand'] !== undefined) out.runInBand = options['runInBand'] as boolean;
  if (options['watch'] !== undefined) out.watch = options['watch'] as boolean;
  if (options['verbose'] !== undefined) out.verbose = options['verbose'] as boolean;
  if (options['timeout'] !== undefined) out.timeout = options['timeout'] as number;
  if (options['coverage'] !== undefined) out.coverage = options['coverage'] as boolean;

  // PM - start / socket
  if (options['port'] !== undefined) out.port = options['port'] as number;
  if (options['socket'] !== undefined) out.socket = options['socket'] as string;
  if (options['db'] !== undefined) out.db = options['db'] as string;
  if (options['background'] !== undefined) out.background = options['background'] as boolean;
  if (options['maxRestarts'] !== undefined) out.maxRestarts = options['maxRestarts'] as number;

  // PM - stop
  if (options['force'] !== undefined) out.force = options['force'] as boolean;

  // PM - logs
  if (options['follow'] !== undefined) out.follow = options['follow'] as boolean;
  if (options['lines'] !== undefined) out.lines = options['lines'] as number;

  // Package manager
  if (options['registry'] !== undefined) out.registry = options['registry'] as string;

  return out;
}
