import * as path from 'path';
import { ParsedArgs } from '../args';
import { c } from '../colors';
import { ensureDir, fileExists, runCmd, resolveEntry } from '../utils/fs';
import { REQUIRED_DECORATOR_FIELDS } from '../tsconfig';

function isTsLike(p: string): boolean {
  return /\.tsx?$/i.test(p);
}

export async function runBuild(opts: ParsedArgs): Promise<void> {
  const cwd = process.cwd();
  const entry = await resolveEntry(cwd, opts.entry);
  const outDir = path.resolve(cwd, opts.outDir || 'dist');
  await ensureDir(outDir);

  console.log(`${c('cyan', '[build]')} entry: ${path.relative(cwd, entry)}`);
  console.log(`${c('cyan', '[build]')} outDir: ${path.relative(cwd, outDir)}`);

  const tsconfigPath = path.join(cwd, 'tsconfig.json');
  const hasTsconfig = await fileExists(tsconfigPath);
  const args: string[] = ['-y', 'tsc'];

  if (hasTsconfig) {
    console.log(c('gray', `[build] tsconfig.json detected — compiling with project settings`));
    args.push('--project', tsconfigPath);
  } else {
    args.push(entry);
    args.push('--rootDir', path.dirname(entry));
    if (!isTsLike(entry)) {
      args.push('--allowJs');
      console.log(c('yellow', '[build] Entry is not TypeScript; enabling --allowJs'));
    }
    args.push('--experimentalDecorators', '--emitDecoratorMetadata');
    args.push('--module', REQUIRED_DECORATOR_FIELDS.module);
    args.push('--target', REQUIRED_DECORATOR_FIELDS.target);
  }

  args.push('--outDir', outDir);
  args.push('--skipLibCheck');

  await runCmd('npx', args);

  console.log(c('green', '✅ Build completed.'));
  console.log(c('gray', `Output placed in ${path.relative(cwd, outDir)}`));
}
