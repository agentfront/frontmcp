import * as path from 'path';
import { spawn } from 'child_process';
import { c } from '../colors.js';
import { fileExists, readJSON } from '@frontmcp/utils';
import { checkRequiredTsOptions } from '../tsconfig.js';
import { resolveEntry } from '../utils/fs.js';

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

  let npmVer = 'unknown';
  try {
    npmVer = await new Promise<string>((resolve, reject) => {
      const child = spawn('npm', ['-v'], { shell: true });
      let out = '';
      child.stdout?.on('data', (d) => (out += String(d)));
      child.on('close', () => resolve(out.trim()));
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
  if (await fileExists(tsconfigPath)) {
    console.log(`✅ tsconfig.json found`);
    const tsconfig = await readJSON<Record<string, any>>(tsconfigPath);
    const { ok: oks, issues } = checkRequiredTsOptions(tsconfig?.compilerOptions);
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
  } catch (e: any) {
    const firstLine = (e?.message as string | undefined)?.split('\n')?.[0] ?? 'entry not found';
    console.log(`❌ entry not detected — ${firstLine}`);
  }

  if (ok) console.log(c('green', '\nAll checks passed. You are ready to go!'));
  else console.log(c('yellow', '\nSome checks failed. See above for fixes.'));
}
