/**
 * E2E: a capability whose feature flag is off is refused when named directly, not only hidden
 * from its listing (GHSA-gf7p-j3hr-h5h4).
 *
 * - `flags://hidden-report` (resource) and `flags://hidden-report/{reportId}` (template) sit
 *   behind `flag-for-hidden-resource`, which is off
 * - `flag-report` (prompt) sits behind `flag-for-prompt`, which is off
 * - `flags://status` (resource) sits behind `flag-for-resource`, which is on
 */
import { expect, test } from '@frontmcp/testing';

test.describe('Feature Flags Direct Access E2E (GHSA-gf7p-j3hr-h5h4)', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-feature-flags/src/main.ts',
    project: 'demo-e2e-feature-flags',
    publicMode: true,
  });

  test.describe('Disabled resource', () => {
    test('is hidden from resources/list', async ({ mcp }) => {
      const resources = await mcp.resources.list();

      expect(resources).not.toContainResource('flags://hidden-report');
    });

    test('is refused on resources/read', async ({ mcp }) => {
      const content = await mcp.resources.read('flags://hidden-report');

      expect(content).toBeError();
      expect(content.error?.message).toContain('disabled by feature flag');
      expect(JSON.stringify(content.raw ?? {})).not.toContain('leaked');
    });
  });

  test.describe('Disabled resource template', () => {
    test('is hidden from resources/templates/list', async ({ mcp }) => {
      const templates = await mcp.resources.listTemplates();

      expect(templates.map((template) => template.name)).not.toContain('hidden-report-by-id');
    });

    test('is refused on resources/read of a URI it matches', async ({ mcp }) => {
      const content = await mcp.resources.read('flags://hidden-report/42');

      expect(content).toBeError();
      expect(content.error?.message).toContain('disabled by feature flag');
      expect(JSON.stringify(content.raw ?? {})).not.toContain('leaked');
    });
  });

  test.describe('Disabled prompt', () => {
    test('is refused on prompts/get', async ({ mcp }) => {
      const result = await mcp.prompts.get('flag-report', {});

      expect(result.isError).toBe(true);
      expect(result.error?.message).toContain('disabled by feature flag');
    });
  });

  test.describe('Enabled resource', () => {
    test('is still readable', async ({ mcp }) => {
      const content = await mcp.resources.read('flags://status');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('accessible');
    });
  });
});
