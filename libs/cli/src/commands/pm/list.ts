import { formatProcessTable, ProcessManager } from '.';
import { ParsedArgs } from '../../core/args';

export async function runList(_opts: ParsedArgs): Promise<void> {
  const pm = new ProcessManager();
  const all = pm.listAll();
  console.log(formatProcessTable(all));
}
