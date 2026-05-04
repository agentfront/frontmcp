// file: libs/cli/src/commands/skills/export.ts
//
// `frontmcp skills export --target cursor|windsurf|copilot` — convert a
// catalog skill into the IDE-rule format the chosen target expects, and
// write the file under the current working directory.

import * as fs from 'fs';
import * as path from 'path';

import { ensureDir, readFile, writeFile } from '@frontmcp/utils';

import { c } from '../../core/colors';
import { getCatalogDir, loadCatalog } from './catalog';
import { exportToCopilot, exportToCursor, exportToWindsurf, type ExporterOutput, type ExportTarget } from './exporters';

export interface ExportSkillsOptions {
  target: ExportTarget;
  /** Specific skill name. When omitted, --all must be set. */
  name?: string;
  all?: boolean;
  outDir?: string;
}

export async function exportSkills(options: ExportSkillsOptions): Promise<void> {
  const manifest = loadCatalog();
  const outDir = options.outDir ?? process.cwd();

  let skills = manifest.skills;
  if (options.name) {
    const found = skills.find((s) => s.name === options.name);
    if (!found) {
      console.error(c('red', `Skill "${options.name}" not found in catalog.`));
      process.exit(1);
    }
    skills = [found];
  } else if (!options.all) {
    console.error(c('red', 'Specify a skill name or pass --all to export every skill.'));
    process.exit(1);
  }

  const catalogDir = getCatalogDir();
  let written = 0;
  for (const skill of skills) {
    const skillDir = path.join(catalogDir, skill.path);
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    let instructions = '';
    try {
      const raw = await readFile(skillMdPath, 'utf8');
      instructions = stripFrontmatter(raw);
    } catch {
      console.warn(c('yellow', `Skipping ${skill.name}: SKILL.md not readable.`));
      continue;
    }

    const input = {
      name: skill.name,
      description: skill.description,
      instructions,
      category: skill.category,
      tags: skill.tags,
    };
    const out = renderForTarget(options.target, input);

    const absPath = path.join(outDir, out.relativePath);
    await ensureDir(path.dirname(absPath));
    if (options.target === 'windsurf') {
      // Windsurf rules live in a single file — append rather than overwrite.
      let existing = '';
      if (fs.existsSync(absPath)) existing = await readFile(absPath, 'utf8');
      await writeFile(absPath, mergeWindsurf(existing, skill.name, out.contents), 'utf8');
    } else {
      await writeFile(absPath, out.contents, 'utf8');
    }
    console.log(c('green', `wrote ${out.relativePath}`));
    written++;
  }

  console.log(c('bold', `\n${written} skill(s) exported to target=${options.target}.\n`));
}

function renderForTarget(
  target: ExportTarget,
  input: { name: string; description: string; instructions: string; category?: string; tags?: string[] },
): ExporterOutput {
  switch (target) {
    case 'cursor':
      return exportToCursor(input);
    case 'windsurf':
      return exportToWindsurf(input);
    case 'copilot':
      return exportToCopilot(input);
  }
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---')) return raw.trim();
  const closeIdx = raw.indexOf('\n---', 3);
  if (closeIdx === -1) return raw.trim();
  return raw.slice(closeIdx + 4).trim();
}

/**
 * Replace or append a `## <name>` block in `.windsurfrules`. Multiple
 * exports into the same file are stable: re-exporting overwrites just the
 * skill's section, leaving siblings untouched.
 */
function mergeWindsurf(existing: string, name: string, sectionContents: string): string {
  if (!existing) return sectionContents;
  const heading = `## ${name}`;
  const idx = existing.indexOf(heading);
  if (idx === -1) {
    return existing.endsWith('\n') ? `${existing}\n${sectionContents}` : `${existing}\n\n${sectionContents}`;
  }
  // Replace from this heading to the next `## ` (or EOF).
  const nextHeadingIdx = existing.indexOf('\n## ', idx + heading.length);
  const tail = nextHeadingIdx === -1 ? '' : existing.slice(nextHeadingIdx);
  return `${existing.slice(0, idx)}${sectionContents.trim()}\n${tail}`;
}
