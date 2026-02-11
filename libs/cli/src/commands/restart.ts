import { ParsedArgs } from '../args';
import { c } from '../colors';
import { ProcessManager, formatProcessDetail } from '../pm';

export async function runRestart(opts: ParsedArgs): Promise<void> {
  const name = opts._[1];
  if (!name) {
    throw new Error('Missing process name. Usage: frontmcp restart <name>');
  }

  const pm = new ProcessManager();

  console.log(`${c('cyan', '[pm]')} restarting "${name}"...`);
  const info = await pm.restart(name);
  console.log(`\n${c('green', 'Restarted successfully:')}\n`);
  console.log(formatProcessDetail(info));
}
