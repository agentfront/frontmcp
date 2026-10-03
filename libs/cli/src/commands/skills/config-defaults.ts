import { resolveConfig, type SkillsCliConfig } from '../../config';

/**
 * The `skills` block of the nearest `frontmcp.config` — the defaults of
 * `frontmcp skills install` / `export` (#680). Explicit flags always win.
 * Without a config the defaults are empty.
 */
export async function loadSkillsDefaults(configPath?: string): Promise<SkillsCliConfig> {
  const resolved = await resolveConfig({ cwd: process.cwd(), mode: 'skills', configPath });
  return resolved.config?.skills ?? {};
}
