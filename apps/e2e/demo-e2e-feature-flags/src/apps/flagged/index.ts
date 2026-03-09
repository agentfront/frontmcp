import { App } from '@frontmcp/sdk';
import FeatureFlagPlugin from '@frontmcp/plugin-feature-flags';
import AlwaysEnabledTool from './tools/always-enabled.tool';
import BetaSearchTool from './tools/beta-search.tool';
import ExperimentalAgentTool from './tools/experimental-agent.tool';
import DefaultTrueTool from './tools/default-true.tool';
import UnflaggedTool from './tools/unflagged.tool';
import CheckFlagTool from './tools/check-flag.tool';
import FlagStatusResource from './resources/flag-status.resource';
import FlagReportPrompt from './prompts/flag-report.prompt';

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
      },
    }),
  ],
  tools: [AlwaysEnabledTool, BetaSearchTool, ExperimentalAgentTool, DefaultTrueTool, UnflaggedTool, CheckFlagTool],
  resources: [FlagStatusResource],
  prompts: [FlagReportPrompt],
})
export class FlaggedApp {}
