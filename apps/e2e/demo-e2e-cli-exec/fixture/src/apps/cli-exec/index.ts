import { App } from '@frontmcp/sdk';
import AddTool from './tools/add.tool';
import TransformDataTool from './tools/transform-data.tool';
import DoctorTool from './tools/doctor.tool';
import GreetTool from './tools/greet.tool';
import JobTool from './tools/job.tool';
import SubscribeTool from './tools/subscribe.tool';
import SkillsTool from './tools/skills.tool';
import AppInfoResource from './resources/app-info.resource';
import ItemByIdTemplate from './resources/item-by-id.resource-template';
import CodeReviewPrompt from './prompts/code-review.prompt';
import { MathHelperSkill } from './skills/math-helper.skill';
import greetingHelper from './skills/greeting-helper.skill';
import ProcessDataJob from './jobs/process-data.job';

@App({
  name: 'CliExec',
  description: 'CLI Exec E2E testing app',
  tools: [AddTool, TransformDataTool, DoctorTool, GreetTool, JobTool, SubscribeTool, SkillsTool],
  resources: [AppInfoResource, ItemByIdTemplate],
  prompts: [CodeReviewPrompt],
  skills: [MathHelperSkill, greetingHelper],
  jobs: [ProcessDataJob],
})
export class CliExecApp {}
