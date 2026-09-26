import FeatureFlagPlugin from '@frontmcp/plugin-feature-flags';
import { App } from '@frontmcp/sdk';

import FlagReportPrompt from './prompts/flag-report.prompt';
import FlagStatusResource from './resources/flag-status.resource';
import HiddenReportByIdResource from './resources/hidden-report-by-id.resource';
import HiddenReportResource from './resources/hidden-report.resource';
import { EnabledWorkflowSkill, HiddenWorkflowSkill } from './skills/flagged-workflows.skill';
import AlwaysEnabledTool from './tools/always-enabled.tool';
import BetaSearchTool from './tools/beta-search.tool';
import CheckFlagTool from './tools/check-flag.tool';
import DefaultTrueTool from './tools/default-true.tool';
import ExperimentalAgentTool from './tools/experimental-agent.tool';
import UnflaggedTool from './tools/unflagged.tool';

@App({
  name: 'flagged',
  plugins: [
    FeatureFlagPlugin.init({
      adapter: 'static',
      flags: {
        'beta-search': true,
        'experimental-agent': false,
        'always-on': true,
        'programmatic-check': true,
        'flag-for-resource': true,
        'flag-for-prompt': false,
        'flag-for-hidden-resource': false,
        'flag-for-skill': true,
        'flag-for-hidden-skill': false,
      },
    }),
  ],
  tools: [AlwaysEnabledTool, BetaSearchTool, ExperimentalAgentTool, DefaultTrueTool, UnflaggedTool, CheckFlagTool],
  resources: [FlagStatusResource, HiddenReportResource, HiddenReportByIdResource],
  prompts: [FlagReportPrompt],
  skills: [EnabledWorkflowSkill, HiddenWorkflowSkill],
})
export class FlaggedApp {}
