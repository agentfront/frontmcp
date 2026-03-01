import * as fs from 'fs';
import { ParsedArgs } from '../../core/args';
import { c } from '../../core/colors';
import { ProcessManager } from '../pm';
import { getRegisteredApp, unregisterApp } from './registry';

export async function runUninstall(opts: ParsedArgs): Promise<void> {
  const name = opts._[1];
  if (!name) {
    throw new Error('Missing app name. Usage: frontmcp uninstall <name>');
  }

  const app = getRegisteredApp(name);
  if (!app) {
    throw new Error(`App "${name}" is not installed.`);
  }

  // Stop the process if running
  const pm = new ProcessManager();
  try {
    await pm.stop(name);
    console.log(`${c('cyan', '[uninstall]')} stopped running process.`);
  } catch (err: unknown) {
    // Only ignore "not found" / "not running" errors
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('No process found') && !msg.includes('is not running')) {
      throw err;
    }
  }

  // Remove app directory
  if (fs.existsSync(app.installDir)) {
    fs.rmSync(app.installDir, { recursive: true, force: true });
    console.log(`${c('cyan', '[uninstall]')} removed ${app.installDir}`);
  }

  // Remove from registry
  unregisterApp(name);

  console.log(`${c('green', `Uninstalled "${name}".`)}`);
}
