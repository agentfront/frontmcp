/**
 * SEP-2640 skill URI hints in the `initialize` instructions the Streamable HTTP / SSE transport
 * (transport.local.adapter) composes with `composeCallerInstructions(scope, { skillUriHints: true })`.
 *
 * The hint block lists `skill://<path>/SKILL.md` URIs, so it must only appear
 * when those resources are actually served (`skillsConfig.mcpResources`), and
 * only name skills the caller may see.
 */
import 'reflect-metadata';

import type { SkillEntry } from '../../../common';
import { composeCallerInstructions, type InstructionsScope } from '../../../skill/skill-instructions.helper';

type SkillsConfig = {
  sep2640InInstructions?: boolean;
  mcpResources?: boolean;
  injectInstructions?: 'off' | 'append' | 'prepend' | 'replace';
};

const DEPLOY_HINT = 'skill://ops/deploy/SKILL.md — Deploy to production';

function makeScope(
  skillsConfig: SkillsConfig,
  instructions?: string,
  servable: (skills: SkillEntry[]) => SkillEntry[] = (skills) => skills,
): InstructionsScope {
  const skill = { metadata: { name: 'deploy', description: 'Deploy to production' }, getSkillPath: () => 'ops/deploy' };
  return {
    metadata: { skillsConfig, instructions },
    skills: { hasAny: () => true, getSkills: () => [skill], getSep2640InstructionUris: () => [] },
    logger: { warn: jest.fn() },
    runFlowForOutput: async (_flow: string, input: { skills: SkillEntry[] }) => ({ skills: servable(input.skills) }),
  } as unknown as InstructionsScope;
}

const hintsFor = (scope: InstructionsScope) => composeCallerInstructions(scope, { skillUriHints: true });

describe('initialize instructions: SEP-2640 skill URI hints', () => {
  it('lists each served SKILL.md URI when sep2640InInstructions is on', async () => {
    expect(await hintsFor(makeScope({ sep2640InInstructions: true }))).toContain(DEPLOY_HINT);
  });

  it('stays silent when sep2640InInstructions is off', async () => {
    expect(await hintsFor(makeScope({ sep2640InInstructions: false }))).not.toContain(DEPLOY_HINT);
  });

  it('stays silent when mcpResources is disabled, since no skill:// URI would resolve', async () => {
    expect(await hintsFor(makeScope({ sep2640InInstructions: true, mcpResources: false }))).not.toContain(DEPLOY_HINT);
  });

  it("stays silent under 'replace', which sends only the server instructions", async () => {
    const scope = makeScope({ sep2640InInstructions: true, injectInstructions: 'replace' }, 'Server prompt.');
    expect(await hintsFor(scope)).toBe('Server prompt.');
  });

  it("keeps the hints when 'replace' falls back to 'append' for empty instructions", async () => {
    const scope = makeScope({ sep2640InInstructions: true, injectInstructions: 'replace' }, '  ');
    expect(await hintsFor(scope)).toContain('skill://ops/deploy/SKILL.md');
  });

  it('leaves out a skill the skills:filter flow drops (#603)', async () => {
    const scope = makeScope({ sep2640InInstructions: true }, undefined, () => []);
    const instructions = await hintsFor(scope);

    expect(instructions).not.toContain('skill://ops/deploy/SKILL.md');
    expect(instructions).not.toContain('deploy');
  });

  it('leaves the skills out rather than failing the handshake when the filter fails', async () => {
    const scope = makeScope({ sep2640InInstructions: true }, 'Server prompt.', () => {
      throw new Error('flag service unavailable');
    });

    expect(await hintsFor(scope)).toBe('Server prompt.');
    expect(scope.logger.warn).toHaveBeenCalled();
  });

  it('sends no hints unless the transport asks for them', async () => {
    const instructions = await composeCallerInstructions(makeScope({ sep2640InInstructions: true }));

    expect(instructions).toContain('**deploy**: Deploy to production');
    expect(instructions).not.toContain(DEPLOY_HINT);
  });
});
