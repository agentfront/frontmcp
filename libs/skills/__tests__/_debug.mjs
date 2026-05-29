import { parseSkillMdFrontmatter } from '../../sdk/src/skill/skill-md-parser';
import fs from 'node:fs';
const content = fs.readFileSync('../catalog/create-tool/examples/01-basic-class-tool.md', 'utf8');
const { frontmatter } = parseSkillMdFrontmatter(content);
console.log(JSON.stringify(frontmatter, null, 2));
