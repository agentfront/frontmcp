import { ParsedArgs } from '../../core/args';
import { c } from '../../core/colors';
import { ProcessManager } from '.';

export async function runStop(opts: ParsedArgs): Promise<void> {
  const name = opts._[1];
  if (!name) {
    throw new Error('Missing process name. Usage: frontmcp stop <name>');
  }

  const pm = new ProcessManager();

  console.log(`${c('cyan', '[pm]')} stopping "${name}"...`);
  await pm.stop(name, { force: opts.force });
  console.log(`${c('green', '[pm]')} "${name}" stopped.`);
}
