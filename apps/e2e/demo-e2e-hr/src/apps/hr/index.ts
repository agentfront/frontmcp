import { App } from '@frontmcp/sdk';
import EmployeeDirectoryTool from './tools/employee-directory.tool';
import HeadcountByDepartmentTool from './tools/headcount-by-department.tool';
import SalaryDistributionTool from './tools/salary-distribution.tool';
import TeamGrowthTool from './tools/team-growth.tool';
import OrgChartTool from './tools/org-chart.tool';
import GenerateOfferLetterTool from './tools/generate-offer-letter.tool';
import EmployeeProfileTool from './tools/employee-profile.tool';

@App({
  name: 'hr',
  tools: [
    EmployeeDirectoryTool,
    HeadcountByDepartmentTool,
    SalaryDistributionTool,
    TeamGrowthTool,
    OrgChartTool,
    GenerateOfferLetterTool,
    EmployeeProfileTool,
  ],
})
export class HrApp {}
