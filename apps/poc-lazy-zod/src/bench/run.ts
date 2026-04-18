/**
 * Spawns each bundled entry N times, interleaved, collects JSON
 * measurements, and writes raw + aggregated results to results/results.json.
 *
 * Interleaving (eager, lazy, eager, lazy, ...) controls for thermal /
 * frequency / background-load drift.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'results');
const EAGER = path.join(OUT_DIR, 'eager.cjs');
const LAZY = path.join(OUT_DIR, 'lazy.cjs');

const N = Number(process.env.POC_N ?? 30);
const WARMUP = Number(process.env.POC_WARMUP ?? 3);
const EXTRA_NODE_ARGS = (process.env.POC_NODE_ARGS ?? '').split(' ').filter(Boolean);

type Measurement = {
  variant: 'eager' | 'lazy';
  coldStartMs: number;
  firstParseMs: number;
  parseAllFirstMs: number;
  parseAllSteadyMs: number;
  count: number;
};

function runOne(bundle: string): Measurement {
  const r = spawnSync('node', ['--no-warnings', ...EXTRA_NODE_ARGS, bundle], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(`node exited ${r.status}: ${r.stderr}`);
  }
  const line = r.stdout.trim().split('\n').pop();
  if (!line) throw new Error('no stdout line from bundle');
  return JSON.parse(line);
}

function main() {
  if (!fs.existsSync(EAGER) || !fs.existsSync(LAZY)) {
    console.error('Bundles missing — run build.ts first.');
    process.exit(1);
  }

  console.log(`[run] N=${N}, warmup=${WARMUP}, nodeArgs=${EXTRA_NODE_ARGS.join(' ') || '(none)'}`);

  const runs: Measurement[] = [];
  const totalRuns = N + WARMUP;
  for (let i = 0; i < totalRuns; i++) {
    runs.push(runOne(EAGER));
    runs.push(runOne(LAZY));
    if ((i + 1) % 5 === 0) process.stdout.write(`  ${i + 1}/${totalRuns}\n`);
  }

  // Drop first WARMUP runs for each variant
  const trimmed: Measurement[] = [];
  let eagerSeen = 0;
  let lazySeen = 0;
  for (const m of runs) {
    if (m.variant === 'eager') {
      if (eagerSeen++ >= WARMUP) trimmed.push(m);
    } else {
      if (lazySeen++ >= WARMUP) trimmed.push(m);
    }
  }

  const bundleSizes = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'bundle-sizes.json'), 'utf8'));
  const outPath = path.join(OUT_DIR, 'results.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        config: { N, warmup: WARMUP, nodeArgs: EXTRA_NODE_ARGS, nodeVersion: process.version },
        bundleSizes,
        runs: trimmed,
      },
      null,
      2,
    ),
  );
  console.log(
    `[run] wrote ${outPath} (${trimmed.length} trimmed runs, ${runs.length - trimmed.length} warmup dropped)`,
  );
}

main();
