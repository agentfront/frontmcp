import {DynamicPlugin, Plugin, ToolHook, FlowCtxOf} from '@frontmcp/sdk';

declare global {
  interface ExtendFrontMcpToolMetadata {
    site?: {
      siteScoped?: boolean;
      adminRequired?: boolean;
      siteIdFieldName?: string;
    }
  }
}

export interface SiteAuthorizationPluginOptions {
  demoAllowAllIfNoClaims?: boolean;
  siteIdFieldName?: string; // default 'siteId'
}

@Plugin({
  name: 'site-authorization',
  description: 'Validates site access and optional admin requirement for site-scoped tools',
})
export default class SiteAuthorizationPlugin extends DynamicPlugin<SiteAuthorizationPluginOptions> {
  opts: SiteAuthorizationPluginOptions;

  constructor(opts: SiteAuthorizationPluginOptions = {}) {
    const mergedOpts: SiteAuthorizationPluginOptions = {
      demoAllowAllIfNoClaims: opts.demoAllowAllIfNoClaims ?? true,
      siteIdFieldName: opts.siteIdFieldName ?? 'siteId'
    };
    super();
    this.opts = mergedOpts;
  }

  private getAllowedSites(authInfo: any): string[] | 'ALL' {
    const user = authInfo?.user as any;
    const sites = user?.sites || user?.tenants;
    if (!sites || (Array.isArray(sites) && sites.length === 0)) {
      return this.opts.demoAllowAllIfNoClaims ? 'ALL' : [];
    }
    if (Array.isArray(sites)) {
      return sites.map(String);
    }
    if (typeof sites === 'string') {
      return [sites];
    }
    return [];

  }

  private isAdmin(authInfo: any): boolean {
    const user = authInfo?.user as any;
    if (!user) return !!this.opts.demoAllowAllIfNoClaims;
    if (user.isAdmin === true) return true;
    const roles: string[] = Array.isArray(user?.roles) ? user.roles : [];
    return roles.includes('admin') || roles.includes('owner') || roles.includes('superadmin');
  }

  @ToolHook.Will('execute', {priority: 900})
  async validateSiteAccess(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const ctx = flowCtx.state.required.toolContext;
    const input: any = ctx.input;
    const meta = ctx.metadata;

    const siteField = meta.site?.siteIdFieldName || this.opts.siteIdFieldName || 'siteId';

    const siteId = input?.[siteField];
    const siteScoped = meta.site?.siteScoped || (siteId !== undefined);
    const adminRequired = meta.site?.adminRequired === true;


    if (!siteScoped) {
      // Not a site-scoped tool; nothing to check here.
      return;
    }

    if (!siteId || typeof siteId !== 'string' || siteId.length === 0) {
      throw new Error(`Missing required ${siteField} for site-scoped operation`);
    }

    const allowed = this.getAllowedSites(ctx.authInfo);
    if (allowed !== 'ALL' && !allowed.includes(siteId)) {
      throw new Error(`Not authorized for site ${siteId}`);
    }

    if (adminRequired && !this.isAdmin(ctx.authInfo)) {
      throw new Error('Admin privileges required');
    }
  }
}
