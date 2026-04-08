#!/usr/bin/env npx tsx
/**
 * Merge duplicate imports from the same module.
 *
 * Before:
 *   import { foo } from '@frontmcp/auth';
 *   import { bar } from '@frontmcp/auth';
 *   import type { Baz } from '@frontmcp/auth';
 *
 * After:
 *   import { bar, foo, type Baz } from '@frontmcp/auth';
 *
 * Uses inline `type` markers (same style as Prettier import sort plugin).
 * Run Prettier after this to sort the merged imports.
 *
 * Usage:
 *   npx tsx scripts/fix-imports.ts                     # changed files vs main
 *   npx tsx scripts/fix-imports.ts --all               # all .ts files in libs/
 *   npx tsx scripts/fix-imports.ts path/to/file.ts     # specific file(s)
 */
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { relative, resolve } from 'path';

function getFiles(): string[] {
  const args = process.argv.slice(2);

  if (args.includes('--all')) {
    return execFileSync('git', ['ls-files', '--', 'libs/**/*.ts'], { encoding: 'utf-8', cwd: process.cwd() })
      .trim()
      .split('\n')
      .filter((f) => f && !f.endsWith('.d.ts'));
  }

  if (args.length > 0 && !args[0].startsWith('--')) {
    return args.filter((f) => f.endsWith('.ts') && existsSync(f));
  }

  let base = 'main';
  try {
    execFileSync('git', ['rev-parse', '--verify', 'main'], { stdio: 'pipe' });
  } catch {
    try {
      execFileSync('git', ['rev-parse', '--verify', 'master'], { stdio: 'pipe' });
      base = 'master';
    } catch {
      console.log('No main or master branch found. Use --all or specify files.');
      process.exit(1);
    }
  }

  const mergeBase = execFileSync('git', ['merge-base', base, 'HEAD'], { encoding: 'utf-8' }).trim();
  return execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', mergeBase], { encoding: 'utf-8' })
    .trim()
    .split('\n')
    .filter((f) => f && f.endsWith('.ts') && !f.endsWith('.d.ts') && existsSync(f));
}

interface ImportSpec {
  name: string;
  isType: boolean;
}

function parseImportLine(line: string): { module: string; specifiers: ImportSpec[]; isTypeImport: boolean } | null {
  const match = line.match(/^import\s+(type\s+)?{([^}]*)}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/);
  if (!match) return null;

  const isTypeImport = !!match[1];
  const specifiers = match[2]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s): ImportSpec => {
      const tm = s.match(/^type\s+(.+)$/);
      if (tm) return { name: tm[1].trim(), isType: true };
      return { name: s.trim(), isType: isTypeImport };
    });

  return { module: match[3], specifiers, isTypeImport };
}

function processFile(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const imports: Array<{ lineIndex: number; parsed: ReturnType<typeof parseImportLine> & {} }> = [];
  const importLineIndices = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('import ') || !line.includes('{') || !line.includes('}')) continue;
    const parsed = parseImportLine(line);
    if (parsed) {
      imports.push({ lineIndex: i, parsed });
      importLineIndices.add(i);
    }
  }

  const byModule = new Map<string, typeof imports>();
  for (const imp of imports) {
    const key = imp.parsed.module;
    if (!byModule.has(key)) byModule.set(key, []);
    byModule.get(key)!.push(imp);
  }

  let needsMerge = false;
  for (const [, group] of byModule) {
    if (group.length > 1) {
      needsMerge = true;
      break;
    }
  }
  if (!needsMerge) return false;

  const newLines: string[] = [];
  const processedModules = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    if (!importLineIndices.has(i)) {
      newLines.push(lines[i]);
      continue;
    }
    const imp = imports.find((x) => x.lineIndex === i);
    if (!imp || processedModules.has(imp.parsed.module)) continue;
    processedModules.add(imp.parsed.module);
    const group = byModule.get(imp.parsed.module)!;

    const seen = new Set<string>();
    const allSpecs: ImportSpec[] = [];
    for (const g of group) {
      for (const spec of g.parsed.specifiers) {
        if (!seen.has(spec.name)) {
          seen.add(spec.name);
          allSpecs.push(spec);
        }
      }
    }

    // Use inline `type` markers — same style as Prettier
    const indent = lines[i].match(/^(\s*)/)?.[1] ?? '';
    const parts = allSpecs
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => (s.isType ? `type ${s.name}` : s.name));

    newLines.push(`${indent}import { ${parts.join(', ')} } from '${imp.parsed.module}';`);
  }

  const newContent = newLines.join('\n');
  if (newContent === content) return false;
  writeFileSync(filePath, newContent, 'utf-8');
  return true;
}

// ============================================
// Pipeline: ESLint → Merge → Prettier
// ============================================

function runEslintTypeImports(targets: string[]): void {
  if (targets.length === 0) return;
  console.log('Step 1: ESLint consistent-type-imports (inline)...');
  try {
    execFileSync(
      'npx',
      [
        'eslint',
        '--no-error-on-unmatched-pattern',
        '--fix',
        '--rule',
        '{"@typescript-eslint/consistent-type-imports": ["warn", {"prefer": "type-imports", "fixStyle": "inline-type-imports"}]}',
        ...targets,
      ],
      { encoding: 'utf-8', stdio: 'pipe', timeout: 120_000 },
    );
  } catch {
    // ESLint exits non-zero on remaining warnings — OK
  }
}

function runPrettier(targets: string[]): void {
  if (targets.length === 0) return;
  console.log('Step 3: Prettier import sort...');
  try {
    execFileSync('npx', ['prettier', '--write', ...targets], {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 120_000,
    });
  } catch {
    // Prettier may warn — OK
  }
}

const files = getFiles();
if (files.length === 0) {
  console.log('No files to process.');
  process.exit(0);
}

console.log(`Processing ${files.length} file(s)...\n`);

// Step 1: ESLint promotes value imports to `type` where only used as types
runEslintTypeImports(files);

// Step 2: Merge duplicate imports from same module
console.log('\nStep 2: Merge duplicate imports...');
let fixedCount = 0;
for (const file of files) {
  try {
    if (processFile(file)) {
      console.log(`  Merged: ${relative(process.cwd(), resolve(file))}`);
      fixedCount++;
    }
  } catch (err) {
    console.warn(`  Error: ${file}: ${(err as Error).message}`);
  }
}

// Step 3: Prettier sorts imports lexicographically
runPrettier(files);

console.log(`\nDone. Merged ${fixedCount} file(s). All imports sorted.`);
