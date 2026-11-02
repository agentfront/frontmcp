/**
 * E2E: the skills in the `initialize` instructions run the `skills:filter` flow for the caller, like
 * `skills/list`, so a flag-disabled skill's name and description never reach a client (#603).
 *
 * - `enabled-workflow` (skill) sits behind `flag-for-skill`, which is on
 * - `hidden-workflow` (skill) sits behind `flag-for-hidden-skill`, which is off
 */
import { expect, test } from '@frontmcp/testing';

const SERVER = 'apps/e2e/demo-e2e-feature-flags/src/main.ts';

test.describe('Feature Flags in the initialize instructions E2E (#603)', () => {
  test.use({ server: SERVER, project: 'demo-e2e-feature-flags', publicMode: true });

  test('sends one compact line that counts only the flag-enabled skill', async ({ mcp }) => {
    expect(mcp.instructions).toBe(
      "This server has 1 skill: the `skill://index.json` resource lists each skill's `SKILL.md` URI.",
    );
  });

  test('leaves the same skill out of the SKILL.md entries in resources/list', async ({ mcp }) => {
    const resources = await mcp.resources.list();

    expect(resources).toContainResource('skill://enabled-workflow/SKILL.md');
    expect(resources).not.toContainResource('skill://hidden-workflow/SKILL.md');
  });
});

test.describe("Feature Flags in the initialize instructions E2E with injectInstructions: 'append' (#603)", () => {
  test.use({
    server: SERVER,
    project: 'demo-e2e-feature-flags',
    publicMode: true,
    env: { SKILLS_INJECT_INSTRUCTIONS: 'append' },
  });

  test('lists a flag-enabled skill in the skill catalog', async ({ mcp }) => {
    expect(mcp.instructions).toContain('**enabled-workflow**: Skill gated behind a feature flag (enabled)');
  });

  test('leaves a flag-disabled skill out of the skill catalog', async ({ mcp }) => {
    expect(mcp.instructions).not.toContain('hidden-workflow');
    expect(mcp.instructions).not.toContain('(disabled)');
  });
});
