import { App } from '@frontmcp/sdk';

import ReviewListTool from './tools/review-list.tool';
import SettingsSetTool from './tools/settings-set.tool';

@App({
  name: 'features',
  description: 'Features turned on and off in a settings file while sessions are live',
  tools: [ReviewListTool, SettingsSetTool],
})
export class FeaturesApp {}
