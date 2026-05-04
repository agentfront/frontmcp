// file: libs/cli/src/commands/skills/exporters/cursor.ts
//
// Convert a catalog skill into a Cursor `.cursor/rules/<name>.mdc` rule file.

export interface CursorExportInput {
  name: string;
  description: string;
  instructions: string;
  category?: string;
  tags?: string[];
  globs?: string[];
}

export interface ExporterOutput {
  /** Relative path the file should be written to (`.cursor/rules/<name>.mdc`). */
  relativePath: string;
  /** Full file contents. */
  contents: string;
}

/**
 * Cursor rules use frontmatter with `description` + optional `globs`. The
 * skill's category is appended as a hash-tag in description so users can grep.
 */
export function exportToCursor(skill: CursorExportInput): ExporterOutput {
  const fmLines = ['---'];
  const desc = skill.category ? `${skill.description} #${skill.category}` : skill.description;
  fmLines.push(`description: ${stringifyOneLine(desc)}`);
  if (skill.globs && skill.globs.length > 0) {
    fmLines.push(`globs: ${JSON.stringify(skill.globs)}`);
  }
  if (skill.tags && skill.tags.length > 0) {
    fmLines.push(`tags: ${JSON.stringify(skill.tags)}`);
  }
  fmLines.push('alwaysApply: false');
  fmLines.push('---');
  const body = `# ${skill.name}\n\n${skill.instructions.trim()}\n`;
  return {
    relativePath: `.cursor/rules/${skill.name}.mdc`,
    contents: `${fmLines.join('\n')}\n\n${body}`,
  };
}

function stringifyOneLine(text: string): string {
  // Cursor frontmatter is YAML-ish; one-line scalars need quoting when they
  // contain `:` or `#`. JSON.stringify gives a safe quoted form.
  if (/[:#"]/.test(text)) return JSON.stringify(text);
  return text;
}
