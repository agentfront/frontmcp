/**
 * Compose a SKILL.md document from `@Skill` decorator metadata + an optional
 * body (typically the contents of the file referenced by `instructions.file`).
 *
 * Claude Code's filesystem-based skills loader discovers skills by reading
 * `SKILL.md` frontmatter (`name`, `description`). A `@Skill`-decorated entry
 * usually points `instructions.file` at a plain markdown body without
 * frontmatter, so the install path needs to synthesize the frontmatter from
 * the decorator metadata before writing the file under `.claude/skills/<name>/`.
 *
 * If the body already starts with a YAML frontmatter block we use it
 * verbatim — the user is treated as the authoritative source.
 */

export interface SkillFrontmatter {
  name: string;
  description?: string;
  tags?: string[];
  license?: string;
}

const FRONTMATTER_DELIMITER = '---';

/**
 * @returns the body with a `---` frontmatter block prepended, unless the
 *   body already starts with one (in which case the body is returned as-is).
 */
export function composeSkillMd(meta: SkillFrontmatter, body: string): string {
  if (hasFrontmatter(body)) {
    return body;
  }
  const lines: string[] = [FRONTMATTER_DELIMITER];
  lines.push(`name: ${yamlScalar(meta.name)}`);
  lines.push(`description: ${yamlScalar(meta.description ?? `${meta.name} skill`)}`);
  if (meta.tags && meta.tags.length > 0) {
    lines.push(`tags: [${meta.tags.map(yamlScalar).join(', ')}]`);
  }
  if (meta.license) {
    lines.push(`license: ${yamlScalar(meta.license)}`);
  }
  lines.push(FRONTMATTER_DELIMITER);
  lines.push('');
  const trimmedBody = body.replace(/^\s+/, '');
  return lines.join('\n') + (trimmedBody.length > 0 ? trimmedBody : `# ${meta.name}\n`);
}

export function hasFrontmatter(body: string): boolean {
  if (!body.startsWith(FRONTMATTER_DELIMITER)) return false;
  const afterFirst = body.slice(FRONTMATTER_DELIMITER.length);
  if (!afterFirst.startsWith('\n') && !afterFirst.startsWith('\r')) return false;
  return afterFirst.includes(`\n${FRONTMATTER_DELIMITER}`);
}

/**
 * Quote scalars that contain YAML-significant characters; leave simple strings
 * unquoted to keep the rendered frontmatter readable.
 */
function yamlScalar(value: string): string {
  if (/[:#&*!|>'"%@`{}[\]\n\r\t]/.test(value) || value.startsWith('-') || value.startsWith('?')) {
    return JSON.stringify(value);
  }
  return value;
}
