#!/usr/bin/env npx tsx
/**
 * Merge duplicate imports from the same module (merge-only, no ESLint/Prettier).
 * Designed to run as a lint-staged command between ESLint and Prettier.
 *
 * Combines:
 *   import { foo } from 'mod';
 *   import { bar } from 'mod';
 *   import type { Baz } from 'mod';
 * Into:
 *   import { bar, foo, type Baz } from 'mod';
 *
 * Usage: npx tsx scripts/merge-imports.ts file1.ts file2.ts ...
 */
import { readFileSync, writeFileSync } from 'fs';

interface ImportSpec {
  name: string;
  isType: boolean;
}

function parseImportLine(line: string): { module: string; specifiers: ImportSpec[] } | null {
  const match = line.match(/^import\s+(type\s+)?{([^}]*)}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/);
  if (!match) return null;
  const isTypeImport = !!match[1];
  return {
    module: match[3],
    specifiers: match[2]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s): ImportSpec => {
        const tm = s.match(/^type\s+(.+)$/);
        return tm ? { name: tm[1].trim(), isType: true } : { name: s.trim(), isType: isTypeImport };
      }),
  };
}

function processFile(filePath: string): void {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const imports: Array<{ idx: number; parsed: NonNullable<ReturnType<typeof parseImportLine>> }> = [];
  const importIndices = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('import ') || !line.includes('{') || !line.includes('}')) continue;
    const parsed = parseImportLine(line);
    if (parsed) {
      imports.push({ idx: i, parsed });
      importIndices.add(i);
    }
  }

  const byModule = new Map<string, typeof imports>();
  for (const imp of imports) {
    let group = byModule.get(imp.parsed.module);
    if (!group) {
      group = [];
      byModule.set(imp.parsed.module, group);
    }
    group.push(imp);
  }

  let needsMerge = false;
  // @ts-expect-error -- unused key from Map.entries()
  for (const [, g] of byModule) {
    if (g.length > 1) {
      needsMerge = true;
      break;
    }
  }
  if (!needsMerge) return;

  const out: string[] = [];
  const done = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    if (!importIndices.has(i)) {
      out.push(lines[i]);
      continue;
    }
    const imp = imports.find((x) => x.idx === i);
    if (!imp || done.has(imp.parsed.module)) continue;
    done.add(imp.parsed.module);
    const group = byModule.get(imp.parsed.module);
    if (!group) throw new Error(`Missing grouped imports for module: ${imp.parsed.module}`);

    const specsByName = new Map<string, ImportSpec>();
    for (const g of group) {
      for (const s of g.parsed.specifiers) {
        const prev = specsByName.get(s.name);
        if (!prev) {
          specsByName.set(s.name, s);
        } else if (prev.isType && !s.isType) {
          // Value import wins over type-only import for same symbol
          specsByName.set(s.name, s);
        }
      }
    }
    const specs = Array.from(specsByName.values());

    const indent = lines[i].match(/^(\s*)/)?.[1] ?? '';
    const parts = specs.sort((a, b) => a.name.localeCompare(b.name)).map((s) => (s.isType ? `type ${s.name}` : s.name));
    out.push(`${indent}import { ${parts.join(', ')} } from '${imp.parsed.module}';`);
  }

  const result = out.join('\n');
  if (result !== content) writeFileSync(filePath, result, 'utf-8');
}

const files = process.argv.slice(2).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
for (const f of files) {
  try {
    processFile(f);
  } catch (err) {
    console.error(`merge-imports: failed to process ${f}:`, err);
  }
}
