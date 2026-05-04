// file: libs/cli/src/commands/skills/exporters/copilot.ts
//
// Convert a catalog skill into a GitHub Copilot instructions file. Copilot
// reads `.github/copilot-instructions.md` (workspace) plus per-skill files
// under `.github/instructions/`. We emit one file per skill so users can
// pick which ones to commit.

import type { CursorExportInput, ExporterOutput } from './cursor';

export type CopilotExportInput = CursorExportInput;

export function exportToCopilot(skill: CopilotExportInput): ExporterOutput {
  const header: string[] = [];
  header.push(`# ${skill.name}`);
  header.push('');
  header.push(`> ${skill.description}`);
  if (skill.category) header.push(`>`);
  if (skill.category) header.push(`> Category: ${skill.category}`);
  if (skill.tags?.length) header.push(`> Tags: ${skill.tags.join(', ')}`);
  header.push('');
  return {
    relativePath: `.github/instructions/${skill.name}.md`,
    contents: `${header.join('\n')}${skill.instructions.trim()}\n`,
  };
}
