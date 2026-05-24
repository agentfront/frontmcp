// file: libs/cli/src/commands/dev/__tests__/dep0190-regression.spec.ts
//
// Issue #381: Node 22+ emits DEP0190 every time `spawn(cmd, [args], { shell: true })`
// is invoked, because the args array is concatenated into the shell command
// without escaping. This source-level guard prevents a regression from
// silently re-introducing the pattern in any `commands/dev/*.ts` entry.

import * as path from 'path';

import { readFile } from '@frontmcp/utils';

// Strip `//` line comments and `/* … */` block comments so the source-level
// grep only inspects actual code. Comments are allowed to mention `shell:true`
// when explaining WHY the codebase avoids it (e.g., #381 history).
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('DEP0190 source regression (#381)', () => {
  const devDir = path.join(__dirname, '..');

  it.each(['doctor.ts', 'dev.ts'])('%s does not pass shell:true to spawn', async (file) => {
    const code = stripComments(await readFile(path.join(devDir, file)));
    // Catch `shell: true` and the historical `shell: useShell` indirection
    // that resolved to `true` on Windows (still triggers DEP0190 there).
    expect(code).not.toMatch(/shell:\s*true\b/);
    expect(code).not.toMatch(/shell:\s*useShell\b/);
  });
});
