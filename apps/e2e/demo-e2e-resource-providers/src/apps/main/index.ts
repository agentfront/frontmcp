import { App } from '@frontmcp/sdk';
import { DataStoreService } from './providers/data-store.provider';
import { CounterPlugin } from '../../plugins/counter/counter.plugin';
import StoreSetTool from './tools/store-set.tool';
import StoreGetTool from './tools/store-get.tool';
import CounterIncrementTool from './tools/counter-increment.tool';
import DebugProvidersTool from './tools/debug-providers.tool';
import StoreContentsResource from './resources/store-contents.resource';
import CounterStatusResource from './resources/counter-status.resource';
import DebugProvidersResource from './resources/debug-providers.resource';

@App({
  name: 'main',
  providers: [DataStoreService],
  plugins: [CounterPlugin],
  tools: [StoreSetTool, StoreGetTool, CounterIncrementTool, DebugProvidersTool],
  resources: [StoreContentsResource, CounterStatusResource, DebugProvidersResource],
})
export class MainApp {}
