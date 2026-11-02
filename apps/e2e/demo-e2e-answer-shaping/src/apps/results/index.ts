import ResultHandlesPlugin from '@frontmcp/plugin-result-handles';
import { App } from '@frontmcp/sdk';

import ExportArchiveTool from './tools/export-archive.tool';
import ExportOrdersTool from './tools/export-orders.tool';
import StrictOrdersTool from './tools/strict-orders.tool';

const resultHandles = () =>
  ResultHandlesPlugin.init({
    thresholdBytes: 8 * 1024,
    ttlSeconds: 4,
    preview: { items: 3, chars: 80 },
    storage: { type: 'memory' },
  });

@App({
  id: 'results',
  name: 'Results',
  tools: [ExportOrdersTool, StrictOrdersTool],
  plugins: [resultHandles()],
})
export class ResultsApp {}

/** A second app with its own copy of the plugin: the one listed result_query reads its handles too. */
@App({ id: 'archive', name: 'Archive', tools: [ExportArchiveTool], plugins: [resultHandles()] })
export class ArchiveApp {}
