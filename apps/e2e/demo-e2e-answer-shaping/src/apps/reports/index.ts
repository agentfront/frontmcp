import { App } from '@frontmcp/sdk';

import ReportLogResource from './resources/report-log.resource';
import BigReportTool from './tools/big-report.tool';
import RecentReportTool from './tools/recent-report.tool';
import RequestHeadersTool from './tools/request-headers.tool';

@App({
  id: 'reports',
  name: 'Reports',
  tools: [BigReportTool, RecentReportTool, RequestHeadersTool],
  resources: [ReportLogResource],
})
export class ReportsApp {}
