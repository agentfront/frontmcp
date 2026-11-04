// file: libs/sdk/src/skill/decision/decisions-api.decider.ts

import { sha256Hex } from '@frontmcp/utils';

import type { SkillDecider, SkillDecision, SkillDecisionCandidate } from './skill-decision.types';

/** Options of {@link decisionsApiDecider}. */
export interface DecisionsApiDeciderOptions {
  /** The API key, sent as `Authorization: Bearer <apiKey>`. Never logged. */
  apiKey: string;
  /**
   * The API's base URL; `POST <baseUrl>/decisions` is called. A gateway that serves the same contract works too,
   * such as `https://api.llmgateway.io/v1` for Jev (`model: 'jev-1.13.0'`).
   * @default 'https://api.openai.com/v1'
   */
  baseUrl?: string;
  /** @default 'gpt-6-luna' */
  model?: string;
  /** The `fetch` to call with; the global one by default. */
  fetch?: typeof fetch;
}

/** The value of the choice that means none of the skills fits. */
export const NO_SKILL_CHOICE = '__none__';

interface DecisionAnswer {
  type: string;
  choice?: string | boolean;
  probabilities?: Array<{ value: string | boolean; probability: number }>;
}

/** The catalog the model reads: the part of the request that stays the same for a skill set, so it can be cached. */
function catalogText(candidates: readonly SkillDecisionCandidate[]): string {
  const lines = candidates.map((c) => {
    const tags = c.tags?.length ? ` [${c.tags.join(', ')}]` : '';
    return `- ${c.id}: ${c.name}: ${c.description}${tags}`;
  });
  return `These are the skills of a server. A skill is a playbook for a kind of task.\n\n${lines.join('\n')}`;
}

/**
 * A {@link SkillDecider} for the Decisions API, `POST /v1/decisions`: one `choice` question whose choices are the
 * candidate skills, plus "none of these". The model answers with a probability for every choice. The catalog goes in
 * `input`, which stays the same for a skill set (a prompt cache can reuse it, keyed by `prompt_cache_key`), and the
 * query in the question.
 */
export function decisionsApiDecider(options: DecisionsApiDeciderOptions): SkillDecider {
  const baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = options.model ?? 'gpt-6-luna';
  return async ({ query, notQuery, candidates, signal }): Promise<SkillDecision[]> => {
    if (candidates.length === 0) return [];
    const catalog = catalogText(candidates);
    const unwanted = notQuery.length > 0 ? ` The user does not want: ${notQuery.join('; ')}.` : '';
    const doFetch = options.fetch ?? fetch;
    const response = await doFetch(`${baseUrl}/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
      signal,
      body: JSON.stringify({
        model,
        input: catalog,
        prompt_cache_key: `skills-${sha256Hex(catalog).slice(0, 32)}`,
        questions: [
          {
            type: 'choice',
            name: 'skill',
            instructions: `Which skill best handles this request: "${query}"?${unwanted}`,
            choices: [
              ...candidates.map((c) => ({ value: c.id, description: c.name })),
              { value: NO_SKILL_CHOICE, description: 'None of these skills fits the request.' },
            ],
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`the Decisions API answered ${response.status}`);
    }
    const decision = (await response.json()) as { answers?: DecisionAnswer[] };
    const answer = decision.answers?.[0];
    if (!answer || answer.type !== 'choice' || !Array.isArray(answer.probabilities)) {
      throw new Error(`the Decisions API answered with no choice (${answer?.type ?? 'no answer'})`);
    }
    const ids = new Set(candidates.map((c) => c.id));
    return answer.probabilities
      .filter((p): p is { value: string; probability: number } => typeof p.value === 'string' && ids.has(p.value))
      .map((p) => ({ id: p.value, probability: p.probability }));
  };
}
