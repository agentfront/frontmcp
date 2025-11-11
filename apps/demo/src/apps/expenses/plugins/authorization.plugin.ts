import {DynamicPlugin, Plugin, FlowCtxOf, httpRespond} from '@frontmcp/sdk';
import {ListToolsHook} from '@frontmcp/core'

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

  @ListToolsHook.Did('findTools')
  async canActivate(flowCtx: FlowCtxOf<'tools:list-tools'>) {
    const {tools} = flowCtx.state.required;
    const {ctx:{authInfo}} = flowCtx.rawInput

    const authorizedTools = tools.filter(({tool}) => {
      const metadata = tool.metadata;

      if (!metadata.authorization) return true;
      const {requiredRoles} = metadata.authorization;
      const roles = (authInfo.user as any).roles as string[];

      // check if required roles are present in the user's roles
      return requiredRoles.every(role => roles.includes(role));
    });

    flowCtx.state.set('tools', authorizedTools);
  }
}
