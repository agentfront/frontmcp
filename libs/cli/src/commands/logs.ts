import { ParsedArgs } from '../args';
import { c } from '../colors';
import { tailLog, followLog, readPidFile } from '../pm';

export async function runLogs(opts: ParsedArgs): Promise<void> {
  const name = opts._[1];
  if (!name) {
    throw new Error('Missing process name. Usage: frontmcp logs <name> [--follow] [--lines N]');
  }

  const pidData = readPidFile(name);
  if (!pidData) {
    console.log(c('yellow', `No process found with name "${name}". No logs available.`));
    return;
  }

  const lines = opts.lines ?? 50;

  if (opts.follow) {
    // Show recent lines first
    const recent = tailLog(name, lines);
    for (const line of recent) {
      console.log(line);
    }

    console.log(c('gray', `--- following logs for "${name}" (Ctrl+C to stop) ---`));

    const stop = followLog(name, (line) => {
      console.log(line);
    });

    await new Promise<void>((resolve) => {
      process.once('SIGINT', () => {
        stop();
        resolve();
      });
      process.once('SIGTERM', () => {
        stop();
        resolve();
      });
    });
  } else {
    const logLines = tailLog(name, lines);
    if (logLines.length === 0) {
      console.log(c('gray', `No log output for "${name}".`));
    } else {
      for (const line of logLines) {
        console.log(line);
      }
    }
  }
}
