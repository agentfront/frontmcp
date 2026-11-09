import { App } from '@frontmcp/sdk';

import AdminOnlyJob from './jobs/admin-only.job';
import AdminSubmittedJob from './jobs/admin-submitted.job';
import OpenJob from './jobs/open.job';
import ScopedReportJob from './jobs/scoped-report.job';
import AdminOnlyWorkflow from './workflows/admin-only.workflow';
import UsesAdminSubmittedWorkflow from './workflows/uses-admin-submitted.workflow';

@App({
  name: 'Permissions',
  description: 'Jobs/workflows permission enforcement E2E app',
  jobs: [AdminOnlyJob, ScopedReportJob, OpenJob, AdminSubmittedJob],
  workflows: [AdminOnlyWorkflow, UsesAdminSubmittedWorkflow],
})
export class PermissionsApp {}
