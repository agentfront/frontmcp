import ResultHandlesPlugin, { type ResultHandlesPluginOptionsInput } from '@frontmcp/plugin-result-handles';
import { App } from '@frontmcp/sdk';

import OrdersLedgerResource from './resources/orders-ledger.resource';
import ExportArchiveTool from './tools/export-archive.tool';
import ExportOrdersTool from './tools/export-orders.tool';
import StrictOrdersTool from './tools/strict-orders.tool';

const resultHandles = (options: ResultHandlesPluginOptionsInput = {}) =>
  ResultHandlesPlugin.init({
    thresholdBytes: 8 * 1024,
    ttlSeconds: 4,
    preview: { items: 3, chars: 80 },
    storage: { type: 'memory' },
    ...options,
  });

@App({
  id: 'results',
  name: 'Results',
  tools: [ExportOrdersTool, StrictOrdersTool],
  resources: [OrdersLedgerResource],
  plugins: [resultHandles({ resources: true })],
})
export class ResultsApp {}

/** A second app with its own copy of the plugin: the one listed result_query reads its handles too. */
@App({ id: 'archive', name: 'Archive', tools: [ExportArchiveTool], plugins: [resultHandles({ slidingTtl: true })] })
export class ArchiveApp {}
