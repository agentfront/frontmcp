import { App } from '@frontmcp/sdk';
import BuildShellTool from './tools/build-shell.tool';
import ResolveImportsTool from './tools/resolve-imports.tool';
import LoadComponentTool from './tools/load-component.tool';
import FetchTypesTool from './tools/fetch-types.tool';

@App({
  name: 'uipack',
  tools: [BuildShellTool, ResolveImportsTool, LoadComponentTool, FetchTypesTool],
})
export class UipackApp {}
