export type Command =
  | 'dev'
  | 'build'
  | 'init'
  | 'doctor'
  | 'inspector'
  | 'create'
  | 'help'
  | 'template'
  | 'version'
  | 'test'
  | 'graph';

export type DeploymentAdapter = 'node' | 'vercel' | 'lambda' | 'cloudflare';
export type RedisSetupOption = 'docker' | 'existing' | 'none';

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
  // Graph command flags
  open?: boolean;
  json?: boolean | string;
  port?: number;
}

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
    // Graph command flags
    else if (a === '--open') out.open = true;
    else if (a === '--json') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        out.json = argv[++i];
      } else {
        out.json = true;
      }
    } else if (a === '--port' || a === '-p') {
      const parsed = parseInt(argv[++i], 10);
      out.port = Number.isNaN(parsed) ? undefined : parsed;
    } else out._.push(a);
  }
  return out;
}
