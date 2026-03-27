import { c } from '../../core/colors';
import { loadCatalog } from './catalog';

export async function listSkills(options: { category?: string; tag?: string; bundle?: string }): Promise<void> {
  const manifest = loadCatalog();
  let skills = manifest.skills;

  if (options.category) {
    skills = skills.filter((s) => s.category === options.category);
  }
  if (options.tag) {
    skills = skills.filter((s) => s.tags.includes(options.tag!));
  }
  if (options.bundle) {
    skills = skills.filter((s) => s.bundle?.includes(options.bundle!));
  }

  if (skills.length === 0) {
    console.log(c('yellow', 'No skills found matching filters.'));
    return;
  }

  // Group by category
  const grouped = new Map<string, typeof skills>();
  for (const skill of skills) {
    const cat = skill.category;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(skill);
  }

  console.log(c('bold', `\n  FrontMCP Skills Catalog (${skills.length} skills)\n`));

  for (const [category, catSkills] of grouped) {
    console.log(`  ${c('cyan', category.toUpperCase())} (${catSkills.length})`);
    for (const skill of catSkills) {
      const desc = skill.description.split('. Use when')[0];
      const res = skill.hasResources ? ' 📁' : '';
      console.log(`    ${c('green', skill.name)}${res}  ${c('gray', desc)}`);
    }
    console.log('');
  }

  console.log(c('gray', '  📁 = has references/scripts/assets'));
  console.log(c('gray', "  Use 'frontmcp skills search <query>' for semantic search"));
  console.log(c('gray', "  Use 'frontmcp skills install <name> --provider claude' to install\n"));
}
