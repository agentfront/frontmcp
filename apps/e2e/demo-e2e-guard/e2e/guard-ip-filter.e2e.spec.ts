/**
 * E2E Tests for Guard — IP Filtering
 *
 * NOTE: IP filtering is implemented in @frontmcp/guard (GuardManager.checkIpFilter)
 * but is not yet wired into the SDK flow stages (call-tool.flow.ts, http.request.flow.ts).
 * These tests are placeholders that should be implemented once the SDK integration is complete.
 */
import { test } from '@frontmcp/testing';

test.describe('Guard IP Filter', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-guard/src/main.ts',
    project: 'demo-e2e-guard',
    publicMode: true,
  });

  test.todo('should block denied IPs — requires SDK flow wiring of checkIpFilter');
  test.todo('should allow allowlisted IPs');
  test.todo('should apply default deny action when IP matches neither list');
  test.todo('should support CIDR ranges for IPv4 and IPv6');
});
