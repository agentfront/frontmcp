/**
 * E2E: the skill catalog in the `initialize` instructions runs the `skills:filter` flow for the
 * caller, like `skills/list`, so a flag-disabled skill's name and description never reach a client (#603).
 *
 * - `enabled-workflow` (skill) sits behind `flag-for-skill`, which is on
 * - `hidden-workflow` (skill) sits behind `flag-for-hidden-skill`, which is off
 */
import { expect, test } from '@frontmcp/testing';

test.describe('Feature Flags in the initialize instructions E2E (#603)', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-feature-flags/src/main.ts',
    project: 'demo-e2e-feature-flags',
    publicMode: true,
  });

  test('lists a flag-enabled skill in the skill catalog', async ({ mcp }) => {
    expect(mcp.instructions).toContain('**enabled-workflow**: Skill gated behind a feature flag (enabled)');
  });

  test('leaves a flag-disabled skill out of the skill catalog', async ({ mcp }) => {
    expect(mcp.instructions).not.toContain('hidden-workflow');
    expect(mcp.instructions).not.toContain('(disabled)');
  });

  test('leaves the same skill out of the SKILL.md entries in resources/list', async ({ mcp }) => {
    const resources = await mcp.resources.list();

    expect(resources).toContainResource('skill://enabled-workflow/SKILL.md');
    expect(resources).not.toContainResource('skill://hidden-workflow/SKILL.md');
  });
});
