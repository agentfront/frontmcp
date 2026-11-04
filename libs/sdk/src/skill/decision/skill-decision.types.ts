// file: libs/sdk/src/skill/decision/skill-decision.types.ts

/** A skill the decision model may choose. */
export interface SkillDecisionCandidate {
  /** The skill's id: what the model answers with. */
  id: string;
  name: string;
  description: string;
  tags?: string[];
}

/** What a {@link SkillDecider} decides on: which of the candidates fit a search query. */
export interface SkillDecisionRequest {
  /** The search query, as the caller wrote it. */
  query: string;
  /** What the caller does not want (`search_skill`'s `notQuery`, `negativeQuery`). */
  notQuery: string[];
  /** The skills to choose among, at most `maxCandidates`, ranked by the search index. */
  candidates: SkillDecisionCandidate[];
  /** Aborted when the decision takes longer than `timeoutMs`. */
  signal: AbortSignal;
}

/** How likely a candidate is to be the skill the query needs, from 0 to 1. */
export interface SkillDecision {
  id: string;
  probability: number;
}

/**
 * Decides which skills fit a search query: a decision model that answers a bounded choice with a probability per
 * option, such as OpenAI's Decisions API (`gpt-6-luna`) or TypeSafe's Jev, without embeddings. Return a probability
 * for each candidate it judged; a candidate left out counts as 0. {@link decisionsApiDecider} builds one for the
 * Decisions API.
 */
export type SkillDecider = (request: SkillDecisionRequest) => Promise<SkillDecision[]>;

/** `skillsConfig.decision`: rank skill search results with a decision model. */
export interface SkillDecisionOptions {
  /** The decision model, such as `decisionsApiDecider({ apiKey })`. */
  decider: SkillDecider;

  /**
   * The most skills the model chooses among: every skill when the catalog has no more (so a query that shares no
   * word with a skill can still find it), or else the index's best matches.
   * @default 50 (at most 254: the Decisions API takes 255 options, one of them "none")
   */
  maxCandidates?: number;

  /**
   * The lowest probability a result keeps.
   * @default 0.1
   */
  minProbability?: number;

  /**
   * How long a decision may take, in milliseconds. A decision that takes longer, fails or is refused leaves the
   * search ranked by the index, and logs a warning.
   * @default 5000
   */
  timeoutMs?: number;

  /**
   * Keep decisions in memory, keyed by the query, anti-query and candidates, so a repeated search makes no call.
   * `false` turns it off.
   * @default { ttlMs: 600000, maxEntries: 500 }
   */
  cache?: false | { ttlMs?: number; maxEntries?: number };
}
