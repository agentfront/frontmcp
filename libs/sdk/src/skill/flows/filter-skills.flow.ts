// file: libs/sdk/src/skill/flows/filter-skills.flow.ts

import { z } from '@frontmcp/lazy-zod';

import { Flow, FlowBase, FlowHooksOf, type FlowPlan, type FlowRunOptions, type SkillEntry } from '../../common';
import { InvalidInputError } from '../../errors';

// z.any() used because SkillEntry is a complex abstract class type
const skillsSchema = z.array(z.any() as z.ZodType<SkillEntry>);

const inputSchema = z.object({
  skills: skillsSchema,
  // The MCP handler context; the flow runs as that caller when no request context is active.
  ctx: z.unknown().optional(),
});

const outputSchema = z.object({
  skills: skillsSchema,
});

const stateSchema = z.object({
  skills: skillsSchema,
});

const plan = {
  pre: ['parseInput'],
  execute: ['filterSkills'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'skills:filter': FlowRunOptions<
      FilterSkillsFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'skills:filter' as const;
const { Stage } = FlowHooksOf<'skills:filter'>(name);

/**
 * Decides which of the given skills the current caller may discover or load.
 *
 * Every skill surface runs it before serving skills: MCP `skills/search`, `skills/list` and
 * `skills/load`, the SEP-2640 `skill://` resources and the HTTP `/skills` API. A skill the flow
 * drops is treated as absent there: left out of listings and not found when named.
 *
 * `filterSkills` is the extension point: hook it with `Will`/`Did`/`Around` and replace
 * `state.skills` with the skills the caller may see.
 */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class FilterSkillsFlow extends FlowBase<typeof name> {
  @Stage('parseInput')
  async parseInput() {
    const parsed = inputSchema.safeParse(this.rawInput);
    if (!parsed.success) {
      throw new InvalidInputError('Invalid Input', parsed.error.issues);
    }
    this.state.set('skills', parsed.data.skills);
  }

  @Stage('finalize')
  async finalize() {
    this.respond({ skills: this.state.required.skills });
  }
}
