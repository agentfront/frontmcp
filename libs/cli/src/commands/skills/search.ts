import { c } from '../../core/colors';
import { searchCatalog } from './catalog';

export async function searchSkills(
  query: string,
  options: { limit: number; tag?: string; category?: string },
): Promise<void> {
  const results = searchCatalog(query, options);

  if (results.length === 0) {
    console.log(c('yellow', `No skills found matching "${query}".`));
    console.log(c('gray', 'Try: frontmcp skills list --category setup'));
    return;
  }

  console.log(c('bold', `\n  Skills matching "${query}":\n`));

  for (const { skill, score } of results) {
    const tags = skill.tags.slice(0, 3).join(', ');
    console.log(`  ${c('green', skill.name)} ${c('gray', `[${skill.category}]`)} ${c('gray', `score:${score}`)}`);
    console.log(`    ${skill.description.split('. Use when')[0]}`);
    console.log(`    ${c('gray', `tags: ${tags}`)}`);
    console.log('');
  }

  console.log(c('gray', `  ${results.length} result(s). Use 'frontmcp skills read <name>' for full details.`));
  console.log(c('gray', `  Install: 'frontmcp skills install <name> --provider claude'\n`));
}
