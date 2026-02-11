import { ParsedArgs } from '../args';
import { ProcessManager, formatProcessTable } from '../pm';

export async function runList(_opts: ParsedArgs): Promise<void> {
  const pm = new ProcessManager();
  const all = pm.listAll();
  console.log(formatProcessTable(all));
}
