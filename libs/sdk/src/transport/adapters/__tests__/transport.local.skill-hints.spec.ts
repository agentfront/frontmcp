/**
 * transport.local.adapter — SEP-2640 skill URI hints in `initialize` instructions.
 *
 * The hint block lists `skill://<path>/SKILL.md` URIs, so it must only appear
 * when those resources are actually served (`skillsConfig.mcpResources`).
 */
import 'reflect-metadata';

import { LocalTransportAdapter } from '../transport.local.adapter';

type SkillsConfig = { sep2640InInstructions?: boolean; mcpResources?: boolean };

function makeAdapter(skillsConfig: SkillsConfig): { buildSkillInstructionHints(): string } {
  const skill = { metadata: { description: 'Deploy to production' }, getSkillPath: () => 'ops/deploy' };
  const adapter = Object.create(LocalTransportAdapter.prototype);
  adapter.scope = {
    metadata: { skillsConfig },
    skills: { hasAny: () => true, getSkills: () => [skill], getSep2640InstructionUris: () => [] },
  };
  return adapter;
}

describe('LocalTransportAdapter.buildSkillInstructionHints', () => {
  it('lists each served SKILL.md URI when sep2640InInstructions is on', () => {
    const hints = makeAdapter({ sep2640InInstructions: true }).buildSkillInstructionHints();
    expect(hints).toContain('skill://ops/deploy/SKILL.md — Deploy to production');
  });

  it('stays silent when sep2640InInstructions is off', () => {
    expect(makeAdapter({ sep2640InInstructions: false }).buildSkillInstructionHints()).toBe('');
  });

  it('stays silent when mcpResources is disabled, since no skill:// URI would resolve', () => {
    const hints = makeAdapter({ sep2640InInstructions: true, mcpResources: false }).buildSkillInstructionHints();
    expect(hints).toBe('');
  });
});
