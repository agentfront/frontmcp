// file: libs/cli/src/commands/skills/exporters/windsurf.ts
//
// Convert a catalog skill into a Windsurf `.windsurfrules` section. Windsurf
// uses a single rules file per project, so callers may want to merge several
// skill exports into one file. This exporter emits a single labeled section
// — the caller decides whether to overwrite or append.

import type { CursorExportInput, ExporterOutput } from './cursor';

export type WindsurfExportInput = CursorExportInput;

/**
 * Build the Windsurf section for one skill. The section is delimited by
 * `## <name>` so multiple skills can coexist in `.windsurfrules`.
 */
export function exportToWindsurf(skill: WindsurfExportInput): ExporterOutput {
  const lines: string[] = [];
  lines.push(`## ${skill.name}`);
  lines.push('');
  lines.push(skill.description);
  if (skill.tags?.length) lines.push(`Tags: ${skill.tags.join(', ')}`);
  if (skill.category) lines.push(`Category: ${skill.category}`);
  lines.push('');
  lines.push(skill.instructions.trim());
  lines.push('');
  return {
    relativePath: '.windsurfrules',
    contents: `${lines.join('\n')}\n`,
  };
}
