import { extendedToolMetadata } from '@frontmcp/sdk';

import SiteAuthorizationPlugin from '../plugins/site-authorization.plugin';
import AdminAddEntryTool from '../tools/admin-add-entry.tool';
import AdminAddExitTool from '../tools/admin-add-exit.tool';
import GetEmployeeDetailsTool from '../tools/get-employee-details.tool';
import ListEmployeesTool from '../tools/list-employees.tool';

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

  const readTools = [
    ['get-employee-details', GetEmployeeDetailsTool],
    ['list-employees', ListEmployeesTool],
  ] as const;
  const callerOfSiteOne = { user: { sub: 'u1', sites: ['s1'] } };

  it.each(readTools)('%s requires a site from a caller limited to some sites', async (_name, tool) => {
    await expect(checkCall(tool, { employeeId: 'e1' }, callerOfSiteOne)).rejects.toThrow('Missing required siteId');
  });

  it.each(readTools)("%s rejects a site outside the caller's sites", async (_name, tool) => {
    await expect(checkCall(tool, { employeeId: 'e1', siteId: 's2' }, callerOfSiteOne)).rejects.toThrow(
      'Not authorized for site s2',
    );
  });

  it.each(readTools)('%s lets a caller allowed every site omit the site', async (_name, tool) => {
    await expect(checkCall(tool, { employeeId: 'e1' }, { user: { sub: 'anon:1' } })).resolves.toBeUndefined();
  });
});
