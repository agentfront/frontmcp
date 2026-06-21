/**
 * Static guard (ROADMAP v1.3 #1): the worker import graph must stay
 * V8-isolate-clean — no random/timers/I-O at module-eval (global) scope, which
 * Cloudflare Workers forbid and which crashes the Worker at startup.
 *
 * Complements `cloudflare-worker.e2e.spec.ts` (the dynamic workerd boot): this
 * scan also covers modules that are tree-shaken out of the fixture, so a
 * regression in a cold path is caught here before it can break a real worker.
 */
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

const ROOT_DIR = path.resolve(__dirname, '../../../..');
const CHECK = path.join(ROOT_DIR, 'scripts', 'check-worker-isolate-safety.mjs');

describe('worker isolate-safety (no module-eval side effects)', () => {
  it('the check script exists', () => {
    expect(fs.existsSync(CHECK)).toBe(true);
  });

  it('the worker-graph libs have no module-eval random/timer/network calls', () => {
    let exitCode = 0;
    let output = '';
    try {
      output = execFileSync('node', [CHECK], { cwd: ROOT_DIR, encoding: 'utf-8' });
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      exitCode = e.status ?? 1;
      output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    // On failure, surface the offending sites so the regression is actionable.
    expect(output ? `${exitCode}\n${output}` : String(exitCode)).toContain('0');
    expect(exitCode).toBe(0);
  });
});
