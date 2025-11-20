export type Command = 'dev' | 'build' | 'init' | 'doctor' | 'inspector' | 'create' | 'help' | 'template' | 'version';

export interface ParsedArgs {
  _: string[];
  outDir?: string;
  entry?: string;
  help?: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out-dir' || a === '-o') out.outDir = argv[++i];
    else if (a === '--entry' || a === '-e') out.entry = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else out._.push(a);
  }
  return out;
}
