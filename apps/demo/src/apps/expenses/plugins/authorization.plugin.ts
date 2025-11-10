import {DynamicPlugin, Plugin, FlowCtxOf, httpRespond} from '@frontmcp/sdk';
import {ToolHook} from '@frontmcp/core'

declare global {
  interface ExtendFrontMcpToolMetadata {
    authorization?: AuthorizationToolOptions;
  }
}

export interface AuthorizationPluginOptions {
  enable?: boolean;
}

export interface AuthorizationToolOptions {
  requiredRoles: string[];
}


@Plugin({
  name: 'authorization',
  description: 'Role-based access control for tools',
})
export default class AuthorizationPlugin extends DynamicPlugin<AuthorizationPluginOptions> {
  constructor(protected options?: AuthorizationPluginOptions) {
    super();
  }

  @ToolHook.Did('findTool')
  async canActivate(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const {tool, authInfo} = flowCtx.state.required;
    const metadata = flowCtx.state.required.tool.metadata;

    if (!metadata.authorization) return;

    const {requiredRoles} = metadata.authorization;
    const roles = (authInfo.user as any).roles as string[];

    // check if required roles are present in the user's roles
    if (requiredRoles.every(role => roles.includes(role))) {
      return;
    }

    flowCtx.fail(new Error('Unauthorized'))
  }
}
