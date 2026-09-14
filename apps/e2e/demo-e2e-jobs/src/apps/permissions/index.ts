import { App } from '@frontmcp/sdk';

import AdminOnlyJob from './jobs/admin-only.job';
import OpenJob from './jobs/open.job';
import ScopedReportJob from './jobs/scoped-report.job';
import AdminOnlyWorkflow from './workflows/admin-only.workflow';

@App({
  name: 'Permissions',
  description: 'Jobs/workflows permission enforcement E2E app',
  jobs: [AdminOnlyJob, ScopedReportJob, OpenJob],
  workflows: [AdminOnlyWorkflow],
})
export class PermissionsApp {}
