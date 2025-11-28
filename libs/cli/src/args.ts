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
  | 'test';

export interface ParsedArgs {
  _: string[];
  outDir?: string;
  entry?: string;
  help?: boolean;
  runInBand?: boolean;
  watch?: boolean;
  verbose?: boolean;
  timeout?: number;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out-dir' || a === '-o') out.outDir = argv[++i];
    else if (a === '--entry' || a === '-e') out.entry = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--runInBand' || a === '-i') out.runInBand = true;
    else if (a === '--watch' || a === '-w') out.watch = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--timeout' || a === '-t') out.timeout = parseInt(argv[++i], 10);
    else out._.push(a);
  }
  return out;
}
