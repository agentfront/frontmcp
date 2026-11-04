// file: libs/sdk/src/skill/skill-search-text.ts

import { type SkillContent } from '../common/interfaces';

/**
 * Stop words to filter from search queries and indexing.
 * Optimized for skill discovery context.
 */
export const SKILL_STOP_WORDS: ReadonlySet<string> = new Set([
  // Articles & Determiners
  'the',
  'a',
  'an',
  'this',
  'that',
  'these',
  'those',
  // Prepositions
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'into',
  // Conjunctions
  'and',
  'or',
  'but',
  'so',
  'as',
  'if',
  'when',
  'where',
  // Pronouns
  'i',
  'me',
  'my',
  'you',
  'your',
  'it',
  'its',
  'we',
  'our',
  'they',
  'their',
  // Auxiliary verbs
  'is',
  'was',
  'are',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'can',
  'could',
  'should',
  'may',
  'might',
  // Common fillers
  'please',
  'help',
  'want',
  'need',
  'like',
  'just',
  'how',
  'what',
]);

/** The most distinct terms a skill's instructions add to its searchable text. */
export const MAX_INSTRUCTION_TERMS = 48;

/**
 * An identifier as words: `getInventory` is `get Inventory`, `find_pets_by-status` is `find pets by status`, and
 * `HTTPHeaders2` is `HTTP Headers 2`.
 */
export function identifierWords(identifier: string): string {
  return identifier
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .replace(/(\p{L})(\p{N})/gu, '$1 $2')
    .replace(/[_\-.:/]+/g, ' ')
    .trim();
}

/**
 * The distinct terms of a skill's instructions, in order of first appearance: words of four or more characters
 * that aren't stop words, and the words of identifiers such as `getInventory`. At most {@link MAX_INSTRUCTION_TERMS},
 * each once, so instructions count at a lower weight than the description, and long instructions don't dilute
 * the description's terms.
 */
export function instructionTerms(instructions: string): string[] {
  const terms = new Set<string>();
  for (const raw of instructions.split(/[^\p{L}\p{M}\p{N}_]+/u)) {
    if (raw.length === 0) continue;
    for (const word of [raw, ...identifierWords(raw).split(' ')]) {
      const term = word.toLowerCase();
      if (term.length < 4 || SKILL_STOP_WORDS.has(term)) continue;
      terms.add(term);
      if (terms.size >= MAX_INSTRUCTION_TERMS) return [...terms];
    }
  }
  return [...terms];
}

/**
 * The text a skill is indexed and matched by. Term weights:
 * - Description: 3x, plus its key terms (most important for matching)
 * - Tags: 2x
 * - Name, tools, actions, parameters, examples: 1x. An action counts by its id, as words (`getInventory` is
 *   `get inventory`), its summary and its description.
 * - Instructions: their distinct terms, once each ({@link instructionTerms})
 */
export function skillSearchText(skill: SkillContent): string {
  const parts: string[] = [];

  // Name (tokenized)
  if (skill.name) {
    const nameParts = skill.name.split(/[:\-_.\s]/).filter(Boolean);
    parts.push(...nameParts);
  }

  // Description (3x weight)
  if (skill.description) {
    parts.push(skill.description, skill.description, skill.description);

    // Extract key terms from description
    const keyTerms = skill.description
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length >= 4 && !SKILL_STOP_WORDS.has(word));
    parts.push(...keyTerms);
  }

  // Tags (2x weight)
  for (const tag of skill.tags ?? []) {
    parts.push(tag, tag);
  }

  // Tools (1x weight)
  for (const tool of skill.tools) {
    parts.push(tool.name);
    if (tool.purpose) {
      parts.push(tool.purpose);
    }
  }

  // Actions (1x weight): a bundle skill's operations
  for (const action of skill.actions ?? []) {
    parts.push(action.actionId, identifierWords(action.actionId));
    if (action.summary) parts.push(action.summary);
    if (action.description) parts.push(action.description);
  }

  // Parameters (1x weight)
  if (skill.parameters) {
    for (const param of skill.parameters) {
      parts.push(param.name);
      if (param.description) {
        parts.push(param.description);
      }
    }
  }

  // Examples (1x weight)
  if (skill.examples) {
    for (const example of skill.examples) {
      parts.push(example.scenario);
      if (example.expectedOutcome) {
        parts.push(example.expectedOutcome);
      }
    }
  }

  // Instructions (each distinct term once)
  if (skill.instructions) {
    parts.push(...instructionTerms(skill.instructions));
  }

  return parts.join(' ');
}

/** Splits text into the terms the skill index counts. */
export type SkillTokenizer = (text: string) => string[];

/**
 * The id the skill index records for its tokenizer in snapshots, joined with the id of the vectoriadb tokenizer it
 * wraps. Change it whenever {@link skillTokenizer} gives other terms, so cached snapshots are re-indexed.
 */
export const SKILL_TOKENIZER_ID = 'frontmcp-skills-1';

/**
 * The skill index's tokenizer: vectoriadb's, which keeps the letters of every script (#1065), without stop words
 * (#1061), for the index and the query alike.
 */
export function skillTokenizer(tokenize: SkillTokenizer): SkillTokenizer {
  return (text) => tokenize(text).filter((term) => !SKILL_STOP_WORDS.has(term));
}

/**
 * A query's terms for {@link queryTermShare}: its tokenizer's terms when there is one, or else its lowercase words
 * that aren't stop words.
 */
export function queryTerms(query: string, tokenize?: SkillTokenizer): string[] {
  if (tokenize) return [...new Set(tokenize(query))];
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0 && !SKILL_STOP_WORDS.has(term));
}

/**
 * The share of a query's terms that the text contains, from 0 to 1: the score of the keyword matches that back up
 * the index (a skill the index has no terms for, or one registered at runtime that it hasn't indexed yet). A term
 * matches a part of a word, so `refund` matches `refunds`. With a tokenizer the text is matched as the index sees it,
 * its words folded and split the same way as the query's (`vogel` matches `Vögel`).
 */
export function queryTermShare(terms: readonly string[], text: string, tokenize?: SkillTokenizer): number {
  if (terms.length === 0) return 0;
  // Terms hold no spaces, so a term found in the space-joined terms lies within one of them
  const haystack = tokenize ? ` ${tokenize(text).join(' ')} ` : text.toLowerCase();
  return terms.filter((term) => haystack.includes(term)).length / terms.length;
}

/**
 * How much of an anti-query the text matches: the highest {@link queryTermShare} of any of its queries, from 0 to 1.
 * The keyword matches subtract `negativeWeight` times this from their score, as the index does with its own
 * similarity, so a skill the anti-query demotes stays demoted.
 */
export function negativeQueryShare(
  negativeQuery: string | readonly string[] | undefined,
  text: string,
  tokenize?: SkillTokenizer,
): number {
  if (negativeQuery === undefined) return 0;
  const queries = typeof negativeQuery === 'string' ? [negativeQuery] : negativeQuery;
  return queries.reduce((max, query) => Math.max(max, queryTermShare(queryTerms(query, tokenize), text, tokenize)), 0);
}
