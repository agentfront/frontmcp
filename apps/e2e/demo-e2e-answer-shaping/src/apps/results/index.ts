import ResultHandlesPlugin from '@frontmcp/plugin-result-handles';
import { App } from '@frontmcp/sdk';

import ExportOrdersTool from './tools/export-orders.tool';
import StrictOrdersTool from './tools/strict-orders.tool';

@App({
  id: 'results',
  name: 'Results',
  tools: [ExportOrdersTool, StrictOrdersTool],
  plugins: [
    ResultHandlesPlugin.init({
      thresholdBytes: 8 * 1024,
      ttlSeconds: 4,
      preview: { items: 3, chars: 80 },
      storage: { type: 'memory' },
    }),
  ],
})
export class ResultsApp {}
