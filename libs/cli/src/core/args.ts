export type Command =
  | 'dev'
  | 'build'
  | 'init'
  | 'doctor'
  | 'inspector'
  | 'create'
  | 'help'
  | 'version'
  | 'test'
  | 'socket'
  // Process Manager commands
  | 'start'
  | 'stop'
  | 'restart'
  | 'status'
  | 'list'
  | 'logs'
  | 'service'
  // Package Manager commands
  | 'install'
  | 'uninstall'
  | 'configure';

export type DeploymentAdapter = 'node' | 'vercel' | 'lambda' | 'cloudflare';
export type RedisSetupOption = 'docker' | 'existing' | 'none';
export type PackageManagerOption = 'npm' | 'yarn' | 'pnpm';

export interface ParsedArgs {
  _: string[];
  outDir?: string;
  entry?: string;
  help?: boolean;
  runInBand?: boolean;
  watch?: boolean;
  verbose?: boolean;
  timeout?: number;
  coverage?: boolean;
  adapter?: DeploymentAdapter;
  // Create command flags
  yes?: boolean;
  target?: DeploymentAdapter;
  redis?: RedisSetupOption;
  cicd?: boolean;
  pm?: PackageManagerOption;
  // Socket command flags
  socket?: string;
  db?: string;
  background?: boolean;
  // Build --exec flag
  exec?: boolean;
  // Build --exec --cli flag
  cli?: boolean;
  // Process Manager flags
  port?: number;
  force?: boolean;
  maxRestarts?: number;
  follow?: boolean;
  lines?: number;
  // Install flags
  registry?: string;
  // Create --nx flag
  nx?: boolean;
}

/**
 * @deprecated Use commander-based parsing via {@link createProgram} instead.
 * Kept for backward compatibility and existing test coverage.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out-dir' || a === '-o') out.outDir = argv[++i];
    else if (a === '--entry' || a === '-e') out.entry = argv[++i];
    else if (a === '--adapter' || a === '-a') out.adapter = argv[++i] as DeploymentAdapter;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--runInBand' || a === '-i') out.runInBand = true;
    else if (a === '--watch' || a === '-w') out.watch = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--timeout' || a === '-t') {
      const parsed = parseInt(argv[++i], 10);
      out.timeout = Number.isNaN(parsed) ? undefined : parsed;
    } else if (a === '--coverage' || a === '-c') out.coverage = true;
    // Create command flags
    else if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--target') out.target = argv[++i] as DeploymentAdapter;
    else if (a === '--redis') out.redis = argv[++i] as RedisSetupOption;
    else if (a === '--cicd') out.cicd = true;
    else if (a === '--no-cicd') out.cicd = false;
    else if (a === '--pm') out.pm = argv[++i] as PackageManagerOption;
    // Socket command flags
    else if (a === '--socket' || a === '-s') out.socket = argv[++i];
    else if (a === '--db') out.db = argv[++i];
    else if (a === '--background' || a === '-b') out.background = true;
    // Build --exec flag
    else if (a === '--exec') out.exec = true;
    else if (a === '--cli') out.cli = true;
    // Process Manager flags
    else if (a === '--port' || a === '-p') {
      const parsed = parseInt(argv[++i], 10);
      out.port = Number.isNaN(parsed) ? undefined : parsed;
    } else if (a === '--force' || a === '-f') out.force = true;
    else if (a === '--max-restarts') {
      const parsed = parseInt(argv[++i], 10);
      out.maxRestarts = Number.isNaN(parsed) ? undefined : parsed;
    } else if (a === '--follow' || a === '-F') out.follow = true;
    else if (a === '--lines' || a === '-n') {
      const parsed = parseInt(argv[++i], 10);
      out.lines = Number.isNaN(parsed) ? undefined : parsed;
    }
    // Create --nx flag
    else if (a === '--nx') out.nx = true;
    // Install flags
    else if (a === '--registry') out.registry = argv[++i];
    else out._.push(a);
  }
  return out;
}
