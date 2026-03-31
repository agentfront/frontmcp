import * as path from 'path';
import { c } from '../../core/colors';
import { fileExists, readFile } from '@frontmcp/utils';
import { loadCatalog, getCatalogDir } from './catalog';

/**
 * Strip YAML frontmatter from markdown content.
 * Returns the body content after the closing `---`.
 */
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const endIdx = content.indexOf('---', 3);
  if (endIdx === -1) return content;
  return content.substring(endIdx + 3).trim();
}

export async function readSkill(
  nameOrPath: string,
  options: { reference?: string; listRefs?: boolean; listExamples?: boolean; examplesForRef?: string },
): Promise<void> {
  // Support colon syntax: "skillName:path/to/file.ext"
  let skillName = nameOrPath;
  let filePath = options.reference;

  if (!filePath && nameOrPath.includes(':')) {
    const colonIdx = nameOrPath.indexOf(':');
    skillName = nameOrPath.substring(0, colonIdx);
    filePath = nameOrPath.substring(colonIdx + 1);
  }

  const manifest = loadCatalog();
  const entry = manifest.skills.find((s) => s.name === skillName);

  if (!entry) {
    console.error(c('red', `Skill "${skillName}" not found in catalog.`));
    console.log(c('gray', "Use 'frontmcp skills list' to see available skills."));
    process.exit(1);
  }

  const catalogDir = getCatalogDir();
  const skillDir = path.join(catalogDir, entry.path);

  // Mode 1: List references
  if (options.listRefs) {
    const refs = entry.references ?? [];
    if (refs.length === 0) {
      console.log(c('yellow', `Skill "${skillName}" has no references.`));
      return;
    }

    console.log(c('bold', `\n  References for ${skillName}:\n`));
    for (const ref of refs) {
      console.log(`  ${c('green', ref.name)}`);
      if (ref.description) {
        console.log(`    ${c('gray', ref.description)}`);
      }
    }
    console.log('');
    console.log(c('gray', `  ${refs.length} reference(s). Read with: frontmcp skills read ${skillName} <reference>`));
    console.log(c('gray', `  Or use colon syntax: frontmcp skills read ${skillName}:<reference>\n`));
    return;
  }

  // Mode 1b: List examples
  if (options.listExamples || options.examplesForRef) {
    const refs = entry.references ?? [];
    const refFilter = options.examplesForRef;

    // Collect all examples, optionally filtered by reference
    const allExamples: Array<{ ref: string; name: string; level: string; description: string }> = [];
    for (const ref of refs) {
      if (refFilter && ref.name !== refFilter) continue;
      if (!ref.examples || ref.examples.length === 0) continue;
      for (const ex of ref.examples) {
        allExamples.push({ ref: ref.name, name: ex.name, level: ex.level, description: ex.description });
      }
    }

    if (refFilter && !refs.some((r) => r.name === refFilter)) {
      console.error(c('red', `Reference "${refFilter}" not found in skill "${skillName}".`));
      console.log(c('gray', `Use 'frontmcp skills read ${skillName} --refs' to list available references.`));
      process.exit(1);
    }

    if (allExamples.length === 0) {
      const scope = refFilter ? `reference "${refFilter}"` : `skill "${skillName}"`;
      console.log(c('yellow', `No examples found for ${scope}.`));
      return;
    }

    const title = refFilter ? `Examples for ${skillName} > ${refFilter}` : `Examples for ${skillName}`;
    console.log(c('bold', `\n  ${title}:\n`));

    let currentRef = '';
    for (const ex of allExamples) {
      if (ex.ref !== currentRef) {
        currentRef = ex.ref;
        console.log(`  ${c('cyan', currentRef)}`);
      }
      const levelTag =
        ex.level === 'advanced'
          ? c('red', ex.level)
          : ex.level === 'intermediate'
            ? c('yellow', ex.level)
            : c('green', ex.level);
      console.log(`    ${c('green', ex.name)} ${c('gray', `[${levelTag}]`)}`);
      if (ex.description) {
        console.log(`      ${c('gray', ex.description)}`);
      }
    }
    console.log('');
    console.log(
      c(
        'gray',
        `  ${allExamples.length} example(s). Read with: frontmcp skills read ${skillName}:examples/<reference>/<example>.md`,
      ),
    );
    console.log('');
    return;
  }

  // Mode 2: Read a specific file (reference or any file in skill dir)
  if (filePath) {
    // Try exact path first, then references/<name>.md fallback
    let targetPath = path.join(skillDir, filePath);

    if (!(await fileExists(targetPath))) {
      // Try with .md extension in references/
      const refPath = path.join(skillDir, 'references', `${filePath}.md`);
      if (await fileExists(refPath)) {
        targetPath = refPath;
      } else {
        // Try with .md extension at the given path
        const withMd = path.join(skillDir, `${filePath}.md`);
        if (await fileExists(withMd)) {
          targetPath = withMd;
        } else {
          console.error(c('red', `File "${filePath}" not found in skill "${skillName}".`));
          if (entry.references && entry.references.length > 0) {
            console.log(c('gray', `Available references: ${entry.references.map((r) => r.name).join(', ')}`));
          }
          console.log(c('gray', `Use 'frontmcp skills read ${skillName} --refs' to list all references.`));
          process.exit(1);
        }
      }
    }

    const content = await readFile(targetPath);
    const displayName = path.relative(skillDir, targetPath);

    console.log(c('bold', `\n  ${skillName} > ${displayName}`));
    console.log(c('gray', '  ─────────────────────────────────────'));
    console.log('');

    // Strip frontmatter for .md files
    if (targetPath.endsWith('.md')) {
      console.log(stripFrontmatter(content));
    } else {
      console.log(content);
    }
    console.log('');
    return;
  }

  // Mode 3: Read main SKILL.md (default)
  const skillMd = path.join(skillDir, 'SKILL.md');

  if (!(await fileExists(skillMd))) {
    console.error(c('red', `SKILL.md not found at ${skillMd}`));
    process.exit(1);
  }

  const content = await readFile(skillMd);

  console.log(c('bold', `\n  ${entry.name}`));
  console.log(c('gray', `  Category: ${entry.category}`));
  console.log(c('gray', `  Tags: ${entry.tags.join(', ')}`));
  console.log(c('gray', `  Targets: ${entry.targets.join(', ')}`));
  console.log(c('gray', `  Bundle: ${entry.bundle?.join(', ') ?? 'none'}`));
  console.log(c('gray', `  Has resources: ${entry.hasResources}`));
  if (entry.references && entry.references.length > 0) {
    console.log(c('gray', `  References: ${entry.references.length} (use --refs to list)`));
    const exampleCount = entry.references.reduce((sum, r) => sum + (r.examples?.length ?? 0), 0);
    if (exampleCount > 0) {
      console.log(c('gray', `  Examples: ${exampleCount} (use --examples to list)`));
    }
  }
  console.log('');
  console.log(c('gray', '  ─────────────────────────────────────'));
  console.log('');

  // Print body (skip frontmatter)
  console.log(stripFrontmatter(content));

  console.log('');
  console.log(c('gray', `  Install: frontmcp skills install ${skillName} --provider claude`));
  if (entry.references && entry.references.length > 0) {
    console.log(c('gray', `  References: frontmcp skills read ${skillName} --refs`));
    const footerExampleCount = entry.references.reduce((sum, r) => sum + (r.examples?.length ?? 0), 0);
    if (footerExampleCount > 0) {
      console.log(c('gray', `  Examples: frontmcp skills read ${skillName} --examples`));
    }
  }
}
