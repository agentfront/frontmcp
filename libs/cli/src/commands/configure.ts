import * as fs from 'fs';
import * as path from 'path';
import { ParsedArgs } from '../args';
import { c } from '../colors';
import { getRegisteredApp } from './install/registry';
import { runQuestionnaire, writeEnvFile } from './install/questionnaire';
import { ExecManifest } from './build/exec/manifest';

export async function runConfigure(opts: ParsedArgs): Promise<void> {
  const name = opts._[1];
  if (!name) {
    throw new Error('Missing app name. Usage: frontmcp configure <name>');
  }

  const app = getRegisteredApp(name);
  if (!app) {
    throw new Error(`App "${name}" is not installed.`);
  }

  // Find manifest in install directory
  const manifestPath = path.join(app.installDir, `${name}.manifest.json`);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ExecManifest;

  if (!manifest.setup?.steps || manifest.setup.steps.length === 0) {
    console.log(c('yellow', `App "${name}" has no setup questionnaire.`));
    return;
  }

  console.log(`${c('bold', `Reconfiguring "${name}"`)}\n`);

  const result = await runQuestionnaire(manifest.setup.steps, {
    silent: opts.yes,
  });

  writeEnvFile(app.installDir, result.envContent);

  console.log(`\n${c('green', 'Configuration saved.')} Restart the app for changes to take effect:`);
  console.log(`  frontmcp restart ${name}`);
}
