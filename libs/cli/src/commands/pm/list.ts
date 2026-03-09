import { ParsedArgs } from '../../core/args';
import { ProcessManager, formatProcessTable } from '.';

export async function runList(_opts: ParsedArgs): Promise<void> {
  const pm = new ProcessManager();
  const all = pm.listAll();
  console.log(formatProcessTable(all));
}
