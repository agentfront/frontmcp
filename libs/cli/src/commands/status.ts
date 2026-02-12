import { ParsedArgs } from '../args';
import { c } from '../colors';
import { ProcessManager, formatProcessDetail, formatProcessTable } from '../pm';

export async function runStatus(opts: ParsedArgs): Promise<void> {
  const name = opts._[1];
  const pm = new ProcessManager();

  if (name) {
    // Show detail for a single process
    const info = pm.getProcessInfo(name);
    if (!info) {
      console.log(c('yellow', `No process found with name "${name}".`));
      return;
    }
    console.log(formatProcessDetail(info));
  } else {
    // Show summary of all processes
    const all = pm.listAll();
    console.log(formatProcessTable(all));
  }
}
