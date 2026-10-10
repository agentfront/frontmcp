import * as path from 'path';

import { c } from '../../core/colors';
import { checkRequiredTsOptions, readTsconfig } from '../../core/tsconfig';
import { resolveEntry } from '../../shared/fs';
import { packageManagerCommand, spawnTool } from '../../shared/tool-command';

function cmpSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export async function runDoctor(): Promise<void> {
  const MIN_NODE = '22.0.0';
  const MIN_NPM = '10.0.0';
  const cwd = process.cwd();

  let ok = true;

  const nodeVer = process.versions.node;
  if (cmpSemver(nodeVer, MIN_NODE) >= 0) {
    console.log(`✅ Node ${nodeVer} (min ${MIN_NODE})`);
  } else {
    ok = false;
    console.log(`❌ Node ${nodeVer} — please upgrade to >= ${MIN_NODE}`);
  }

  try {
    const npmVer = await new Promise<string>((resolve, reject) => {
      // #731 — no shell (DEP0190, #381) and no `npm.cmd`, which a shell-less
      // spawn cannot start on Windows: on Windows this runs npm's own
      // npm-cli.js with node (see tool-command.ts).
      const child = spawnTool(packageManagerCommand('npm', ['-v']));
      let out = '';
      child.stdout?.on('data', (d) => (out += String(d)));
      child.on('close', (code) => {
        if (code === 0) resolve(out.trim());
        else reject(new Error(`npm -v exited with code ${code}`));
      });
      child.on('error', reject);
    });
    if (cmpSemver(npmVer, MIN_NPM) >= 0) {
      console.log(`✅ npm ${npmVer} (min ${MIN_NPM})`);
    } else {
      ok = false;
      console.log(`❌ npm ${npmVer} — please upgrade to >= ${MIN_NPM}`);
    }
  } catch {
    ok = false;
    console.log('❌ npm not found in PATH');
  }

  const tsconfigPath = path.join(cwd, 'tsconfig.json');
  let tsconfig: Awaited<ReturnType<typeof readTsconfig>>;
  let tsconfigError: string | undefined;
  try {
    tsconfig = await readTsconfig(tsconfigPath);
  } catch (err) {
    tsconfigError = err instanceof Error ? err.message : String(err);
  }
  if (tsconfigError) {
    // Comments and trailing commas parse fine; this is a real syntax error.
    ok = false;
    console.log(`❌ ${tsconfigError} — fix it, then run ${c('cyan', 'frontmcp init')}`);
  } else if (tsconfig) {
    console.log(`✅ tsconfig.json found`);
    const { ok: oks, issues } = checkRequiredTsOptions(tsconfig.config['compilerOptions']);
    for (const line of oks) console.log(c('green', `  ✓ ${line}`));
    if (issues.length) {
      ok = false;
      for (const line of issues) console.log(c('yellow', `  • ${line}`));
      console.log(c('cyan', `  -> Run "frontmcp init" to apply the required settings.`));
    }
  } else {
    ok = false;
    console.log(`❌ tsconfig.json not found — run ${c('cyan', 'frontmcp init')}`);
  }

  try {
    const entry = await resolveEntry(cwd);
    console.log(`✅ entry detected: ${path.relative(cwd, entry)}`);
  } catch (e: unknown) {
    ok = false;
    const firstLine = e instanceof Error ? (e.message.split('\n')[0] ?? 'entry not found') : 'entry not found';
    console.log(`❌ entry not detected — ${firstLine}`);
  }

  if (ok) console.log(c('green', '\nAll checks passed. You are ready to go!'));
  else {
    console.log(c('yellow', '\nSome checks failed. See above for fixes.'));
    process.exitCode = 1;
  }
}
