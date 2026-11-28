import { App } from '@frontmcp/sdk';

import InvoiceListTool from './tools/invoice-list.tool';
import ReviewListTool from './tools/review-list.tool';
import SettingsSetTool from './tools/settings-set.tool';

@App({
  name: 'features',
  description: 'Features turned on and off in a settings file while sessions are live',
  tools: [ReviewListTool, InvoiceListTool, SettingsSetTool],
})
export class FeaturesApp {}
