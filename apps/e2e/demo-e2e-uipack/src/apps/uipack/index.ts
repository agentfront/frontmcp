import { App } from '@frontmcp/sdk';

import BuildShellTool from './tools/build-shell.tool';
import FetchTypesTool from './tools/fetch-types.tool';
import LoadComponentTool from './tools/load-component.tool';
import ResolveImportsTool from './tools/resolve-imports.tool';

@App({
  name: 'uipack',
  tools: [BuildShellTool, ResolveImportsTool, LoadComponentTool, FetchTypesTool],
})
export class UipackApp {}
