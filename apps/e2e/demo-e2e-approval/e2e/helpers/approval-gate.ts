import { expect, test } from '@frontmcp/testing';

const APPROVAL_REQUIRED_MESSAGE = 'requires approval to execute';
const PRE_APPROVED_DEPLOYMENT = { type: 'deployment', identifier: 'prod-eu-blue' };

/**
 * The approval gate checks for one server setup. Each setup needs its own spec file, because
 * `test.use` configures one server per file.
 */
export function describeApprovalGate(setupName: string, serverEntry: string): void {
  test.describe(`Approval gate with ${setupName} (GHSA-r848-p7wf-96rc)`, () => {
    test.use({
      server: serverEntry,
      project: 'demo-e2e-approval',
      publicMode: true,
    });

    test('refuses all three calls from the report and runs none of them', async ({ mcp }) => {
      const withoutContext = await mcp.tools.call('deploy-service', { service: 'billing' });
      const withOtherContext = await mcp.tools.call('deploy-service', {
        service: 'billing',
        context: { type: 'deployment', identifier: 'staging' },
      });
      const withPreApprovedContext = await mcp.tools.call('deploy-service', {
        service: 'billing',
        context: PRE_APPROVED_DEPLOYMENT,
      });

      for (const refused of [withoutContext, withOtherContext, withPreApprovedContext]) {
        expect(refused).toBeError();
        expect(refused).toHaveTextContent(APPROVAL_REQUIRED_MESSAGE);
      }

      const log = await mcp.tools.call('deployment-log', {});
      expect(log).toBeSuccessful();
      expect(log.json()).toEqual({ deployed: [] });
    });

    test('runs the tool once the session holds an approval', async ({ mcp }) => {
      expect(await mcp.tools.call('approve-deploy', {})).toBeSuccessful();

      const deployment = await mcp.tools.call('deploy-service', { service: 'search' });

      expect(deployment).toBeSuccessful();
      expect(deployment.json()).toEqual({ deployed: 'search' });
    });
  });
}
