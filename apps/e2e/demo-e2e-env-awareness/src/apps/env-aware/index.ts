import { App } from '@frontmcp/sdk';

// Tools
import AlwaysAvailableTool from './tools/always-available.tool';
import CurrentPlatformTool from './tools/current-platform.tool';
import ImpossiblePlatformTool from './tools/impossible-platform.tool';
import NodeRuntimeTool from './tools/node-runtime.tool';
import BrowserOnlyTool from './tools/browser-only.tool';
import StandaloneDeployTool from './tools/standalone-deploy.tool';
import ServerlessOnlyTool from './tools/serverless-only.tool';
import MultiConstraintTool from './tools/multi-constraint.tool';
import MultiConstraintFailTool from './tools/multi-constraint-fail.tool';
import HiddenButAvailableTool from './tools/hidden-but-available.tool';
import TestEnvOnlyTool from './tools/test-env-only.tool';
import ProductionOnlyTool from './tools/production-only.tool';
import DevelopmentOnlyTool from './tools/development-only.tool';

// Resources
import NodeInfoResource from './resources/node-info.resource';
import BrowserStorageResource from './resources/browser-storage.resource';

// Prompts
import NodeDebugPrompt from './prompts/node-debug.prompt';
import EdgePrompt from './prompts/edge-prompt.prompt';

@App({
  name: 'env-aware',
  description: 'App for testing environment-aware availability filtering',
  tools: [
    AlwaysAvailableTool,
    CurrentPlatformTool,
    ImpossiblePlatformTool,
    NodeRuntimeTool,
    BrowserOnlyTool,
    StandaloneDeployTool,
    ServerlessOnlyTool,
    MultiConstraintTool,
    MultiConstraintFailTool,
    HiddenButAvailableTool,
    TestEnvOnlyTool,
    ProductionOnlyTool,
    DevelopmentOnlyTool,
  ],
  resources: [NodeInfoResource, BrowserStorageResource],
  prompts: [NodeDebugPrompt, EdgePrompt],
})
export class EnvAwareApp {}
