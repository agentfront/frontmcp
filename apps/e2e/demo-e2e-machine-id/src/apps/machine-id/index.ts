import { App } from '@frontmcp/sdk';

import GetDeploymentModeTool from './tools/get-deployment-mode.tool';
import GetMachineIdTool from './tools/get-machine-id.tool';
import GetRuntimeContextTool from './tools/get-runtime-context.tool';

@App({
  name: 'machine-id',
  tools: [GetMachineIdTool, GetRuntimeContextTool, GetDeploymentModeTool],
})
export default class MachineIdApp {}
