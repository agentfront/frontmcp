import { HttpRoute, HttpRouteContext } from '@frontmcp/sdk';

/** The `matchTenant` profile the `tenant-scoped` tool's rule matches, on an HTTP route: the tenant id is in the path. */
@HttpRoute({ method: 'GET', path: '/tenants/:tenantId/report', auth: 'bearer', authorities: 'matchTenant' })
export default class TenantReportRoute extends HttpRouteContext {
  handle() {
    return { tenant: this.params['tenantId'], sub: this.auth.user.sub, roles: [...this.auth.roles] };
  }
}
