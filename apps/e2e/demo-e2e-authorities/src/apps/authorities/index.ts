import { App } from '@frontmcp/sdk';
import PublicTool from './tools/public.tool';
import AdminOnlyTool from './tools/admin-only.tool';
import EditorOrAdminTool from './tools/editor-or-admin.tool';
import TenantScopedTool from './tools/tenant-scoped.tool';
import ProfileAdminTool from './tools/profile-admin.tool';
import ProfileMultiTool from './tools/profile-multi.tool';
import PermissionsTool from './tools/permissions.tool';
import CombinatorTool from './tools/combinator.tool';
import AdminConfigResource from './resources/admin-config.resource';
import PublicInfoResource from './resources/public-info.resource';

@App({
  name: 'authorities',
  description: 'Authorities E2E testing tools and resources',
  tools: [
    PublicTool,
    AdminOnlyTool,
    EditorOrAdminTool,
    TenantScopedTool,
    ProfileAdminTool,
    ProfileMultiTool,
    PermissionsTool,
    CombinatorTool,
  ],
  resources: [AdminConfigResource, PublicInfoResource],
})
export class AuthoritiesApp {}
