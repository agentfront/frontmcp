import { extendedToolMetadata } from '@frontmcp/sdk';

import SiteAuthorizationPlugin from '../plugins/site-authorization.plugin';
import AdminAddEntryTool from '../tools/admin-add-entry.tool';
import AdminAddExitTool from '../tools/admin-add-exit.tool';

/** Run the plugin's check for a call to `tool` with the tool's declared metadata. */
function checkCall(tool: object, input: Record<string, unknown>, authInfo: Record<string, unknown>): Promise<void> {
  const metadata = Reflect.getMetadata(extendedToolMetadata, tool);
  const flowCtx = { state: { required: { toolContext: { input, metadata, authInfo } } } };
  return new SiteAuthorizationPlugin().validateSiteAccess(flowCtx as never);
}

describe('SiteAuthorizationPlugin', () => {
  const adminCall = { employeeId: 'e1', siteId: 's1', at: 0 };
  const adminTools = [
    ['admin-add-entry', AdminAddEntryTool],
    ['admin-add-exit', AdminAddExitTool],
  ] as const;

  it.each(adminTools)('%s rejects a caller without an admin role', async (_name, tool) => {
    await expect(checkCall(tool, adminCall, { user: { sub: 'anon:1' } })).rejects.toThrow('Admin privileges required');
  });

  it.each(adminTools)('%s rejects a request without a user', async (_name, tool) => {
    await expect(checkCall(tool, adminCall, {})).rejects.toThrow('Admin privileges required');
  });

  it.each(adminTools)('%s accepts a caller with the admin role', async (_name, tool) => {
    await expect(checkCall(tool, adminCall, { user: { sub: 'u1', roles: ['admin'] } })).resolves.toBeUndefined();
  });
});
