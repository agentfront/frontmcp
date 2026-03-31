import { App } from '@frontmcp/sdk';
import { DataStoreService } from './providers/data-store.provider';
import { CatalogService } from './providers/catalog.provider';
import { CounterPlugin } from '../../plugins/counter/counter.plugin';
import StoreSetTool from './tools/store-set.tool';
import StoreGetTool from './tools/store-get.tool';
import CounterIncrementTool from './tools/counter-increment.tool';
import DebugProvidersTool from './tools/debug-providers.tool';
import StoreContentsResource from './resources/store-contents.resource';
import CounterStatusResource from './resources/counter-status.resource';
import DebugProvidersResource from './resources/debug-providers.resource';
import CategoryProductsResource from './resources/category-products.resource';
import ProductDetailResource from './resources/product-detail.resource';
import PlainTemplateResource from './resources/plain-template.resource';

@App({
  name: 'main',
  providers: [DataStoreService, CatalogService],
  plugins: [CounterPlugin],
  tools: [StoreSetTool, StoreGetTool, CounterIncrementTool, DebugProvidersTool],
  resources: [
    StoreContentsResource,
    CounterStatusResource,
    DebugProvidersResource,
    CategoryProductsResource,
    ProductDetailResource,
    PlainTemplateResource,
  ],
})
export class MainApp {}
