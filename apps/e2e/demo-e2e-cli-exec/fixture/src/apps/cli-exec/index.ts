import { App } from '@frontmcp/sdk';

import ProcessDataJob from './jobs/process-data.job';
import CodeReviewPrompt from './prompts/code-review.prompt';
import ExplainCalcPrompt from './prompts/explain-calc.prompt';
import AppInfoResource from './resources/app-info.resource';
import ItemByIdTemplate from './resources/item-by-id.resource-template';
import greetingHelper from './skills/greeting-helper.skill';
import { MathHelperSkill } from './skills/math-helper.skill';
import AddTool from './tools/add.tool';
import DivideTool from './tools/divide.tool';
import DoctorTool from './tools/doctor.tool';
import GreetTool from './tools/greet.tool';
import JobTool from './tools/job.tool';
import SkillsTool from './tools/skills.tool';
import SubscribeTool from './tools/subscribe.tool';
import TransformDataTool from './tools/transform-data.tool';

@App({
  name: 'CliExec',
  description: 'CLI Exec E2E testing app',
  tools: [AddTool, DivideTool, TransformDataTool, DoctorTool, GreetTool, JobTool, SubscribeTool, SkillsTool],
  resources: [AppInfoResource, ItemByIdTemplate],
  prompts: [CodeReviewPrompt, ExplainCalcPrompt],
  skills: [MathHelperSkill, greetingHelper],
  jobs: [ProcessDataJob],
})
export class CliExecApp {}
