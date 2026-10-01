import { expect, test } from '@frontmcp/testing';

const APPROVAL_REQUIRED_MESSAGE = 'requires approval to execute';

/**
 * `alwaysPrompt: true` checks for one server setup (#678): each approval admits exactly one call.
 * Each setup needs its own spec file, because `test.use` configures one server per file.
 */
export function describeAlwaysPrompt(setupName: string, serverEntry: string): void {
  test.describe(`alwaysPrompt with ${setupName} (#678)`, () => {
    test.use({
      server: serverEntry,
      project: 'demo-e2e-approval',
      publicMode: true,
    });

    test('runs one call per approval and prompts again on the next', async ({ mcp }) => {
      const unapproved = await mcp.tools.call('rotate-keys', {});
      expect(unapproved).toBeError();
      expect(unapproved).toHaveTextContent(APPROVAL_REQUIRED_MESSAGE);

      expect(await mcp.tools.call('approve-rotate-keys', {})).toBeSuccessful();

      const approved = await mcp.tools.call('rotate-keys', {});
      expect(approved).toBeSuccessful();
      expect(approved.json()).toEqual({ rotated: true });

      const next = await mcp.tools.call('rotate-keys', {});
      expect(next).toBeError();
      expect(next).toHaveTextContent(APPROVAL_REQUIRED_MESSAGE);

      expect(await mcp.tools.call('approve-rotate-keys', {})).toBeSuccessful();
      expect(await mcp.tools.call('rotate-keys', {})).toBeSuccessful();

      const log = await mcp.tools.call('deployment-log', {});
      expect(log.json()).toEqual({ deployed: ['rotate-keys', 'rotate-keys'] });
    });
  });
}
