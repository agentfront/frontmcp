/**
 * Catalog loader and TF-IDF search engine for skills.
 *
 * Uses vectoriadb's TFIDFVectoria for proper TF-IDF similarity search with
 * weighted document fields: description 3x, tags 2x, name 1x, category 1x.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TFIDFVectoria } from 'vectoriadb';

interface SkillEntry {
  name: string;
  category: string;
  description: string;
  path: string;
  targets: string[];
  hasResources: boolean;
  tags: string[];
  bundle?: string[];
}

interface SkillManifest {
  version: number;
  skills: SkillEntry[];
}

export interface SearchResult {
  skill: SkillEntry;
  score: number;
}

interface SkillDocMetadata {
  id: string;
  skill: SkillEntry;
}

const STOP_WORDS = new Set([
  // Articles & determiners
  'the',
  'a',
  'an',
  'this',
  'that',
  'these',
  'those',
  'each',
  'every',
  'some',
  'any',
  'no',
  // Conjunctions & prepositions
  'and',
  'or',
  'but',
  'nor',
  'for',
  'yet',
  'so',
  'with',
  'from',
  'into',
  'onto',
  'about',
  'by',
  'at',
  'in',
  'on',
  'to',
  'of',
  'as',
  'if',
  'than',
  'then',
  'between',
  'through',
  'after',
  'before',
  'during',
  'without',
  'within',
  'along',
  'across',
  'against',
  'under',
  'over',
  'above',
  'below',
  // Pronouns
  'your',
  'you',
  'it',
  'its',
  'we',
  'our',
  'they',
  'them',
  'their',
  'he',
  'she',
  'his',
  'her',
  'who',
  'which',
  'what',
  'where',
  'when',
  'how',
  'why',
  // Verbs (auxiliary / common)
  'is',
  'am',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'having',
  'do',
  'does',
  'did',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'must',
  'can',
  'could',
  'need',
  'use',
  'using',
  'used',
  // Adverbs & modifiers
  'not',
  'very',
  'also',
  'just',
  'only',
  'more',
  'most',
  'less',
  'well',
  'even',
  'still',
  'already',
  'always',
  'never',
  'often',
  'too',
  'here',
  'there',
  'now',
  // Common filler
  'all',
  'both',
  'other',
  'another',
  'such',
  'like',
  'get',
  'set',
  'new',
  'make',
  'see',
  'way',
  'etc',
  'via',
]);

let cachedManifest: SkillManifest | undefined;
let cachedIndex: TFIDFVectoria<SkillDocMetadata> | undefined;

/**
 * Load the catalog manifest via the @frontmcp/skills package.
 * Works in both monorepo (workspace symlink) and installed (npx/npm) environments.
 */
export function loadCatalog(): SkillManifest {
  if (cachedManifest) return cachedManifest;

  const manifestPath = resolveManifestPath();
  cachedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as SkillManifest;
  return cachedManifest;
}

/**
 * Resolve the path to skills-manifest.json from the @frontmcp/skills package.
 */
function resolveManifestPath(): string {
  // Primary: resolve directly from the @frontmcp/skills package
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require.resolve('@frontmcp/skills/catalog/skills-manifest.json');
  } catch {
    // Not resolvable via subpath — try via package root
  }

  // Fallback: find the package root and navigate to catalog/
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkgJsonPath = require.resolve('@frontmcp/skills/package.json');
    const pkgRoot = path.dirname(pkgJsonPath);
    const manifestPath = path.join(pkgRoot, 'catalog', 'skills-manifest.json');
    if (fs.existsSync(manifestPath)) return manifestPath;
  } catch {
    // Package not found at all
  }

  // Monorepo dev fallback: walk up from __dirname to find libs/skills/catalog/
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'libs', 'skills', 'catalog', 'skills-manifest.json');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }

  throw new Error(
    'Skills catalog not found. Make sure @frontmcp/skills is installed or you are in the FrontMCP monorepo.',
  );
}

/**
 * Resolve the catalog directory path.
 */
export function getCatalogDir(): string {
  return path.dirname(resolveManifestPath());
}

/**
 * Build and cache the TF-IDF search index from the catalog manifest.
 */
function getSearchIndex(): TFIDFVectoria<SkillDocMetadata> {
  if (cachedIndex) return cachedIndex;

  const manifest = loadCatalog();
  cachedIndex = new TFIDFVectoria<SkillDocMetadata>({
    defaultTopK: 10,
    defaultSimilarityThreshold: 0.0,
  });

  const documents = manifest.skills.map((skill) => ({
    id: skill.name,
    text: buildSearchableText(skill),
    metadata: { id: skill.name, skill },
  }));

  cachedIndex.addDocuments(documents);
  cachedIndex.reindex();

  return cachedIndex;
}

/**
 * Build weighted searchable text for TF-IDF indexing.
 * Follows the same weighting pattern as the SDK's MemorySkillProvider.
 */
function buildSearchableText(skill: SkillEntry): string {
  const parts: string[] = [];

  // Name tokens (1x)
  const nameParts = skill.name.split(/[-_.\s]/).filter(Boolean);
  parts.push(...nameParts);

  // Description (3x weight — repeat for TF-IDF term frequency boost)
  if (skill.description) {
    parts.push(skill.description, skill.description, skill.description);

    // Extract key terms from description (additional boost for meaningful words)
    const keyTerms = skill.description
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
    parts.push(...keyTerms);
  }

  // Tags (2x weight)
  for (const tag of skill.tags) {
    parts.push(tag, tag);
  }

  // Category (1x weight)
  parts.push(skill.category);

  return parts.join(' ');
}

/**
 * Search skills using TF-IDF similarity via vectoriadb.
 */
export function searchCatalog(
  query: string,
  options?: { tag?: string; category?: string; limit?: number },
): SearchResult[] {
  const index = getSearchIndex();
  const topK = options?.limit ?? 10;

  const filter = (metadata: SkillDocMetadata): boolean => {
    if (options?.tag && !metadata.skill.tags.includes(options.tag)) return false;
    if (options?.category && metadata.skill.category !== options.category) return false;
    return true;
  };

  const results = index.search(query, {
    topK,
    threshold: 0.01,
    filter,
  });

  return results.map((r) => ({
    skill: r.metadata.skill,
    score: r.score,
  }));
}
