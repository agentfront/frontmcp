import { App } from '@frontmcp/sdk';

import AnalyzeTextJob from './jobs/analyze-text.job';
import GreetJob from './jobs/greet.job';
import GreetAndAnalyzeWorkflow from './workflows/greet-and-analyze.workflow';

@App({
  name: 'Jobs',
  description: 'Jobs and workflows E2E testing app',
  jobs: [GreetJob, AnalyzeTextJob],
  workflows: [GreetAndAnalyzeWorkflow],
})
export class JobsApp {}
