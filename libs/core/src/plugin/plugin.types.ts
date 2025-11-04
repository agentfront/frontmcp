import {
  AuthHookStage,
  PartialStagesType,
  SessionHookStage,
} from '@frontmcp/sdk';
import { ToolExecuteStage } from '../tool/flows/tool.execute.flow';

declare global {
  // eslint-disable-next-line
  export interface PublicRouteFlows {
    // Extendable interfaces
  }

  // eslint-disable-next-line
  export interface AuthorizedRouteFlows {
    // Extendable interfaces
  }
}

export interface FrontMcpHooksByStage extends PublicRouteFlows, AuthorizedRouteFlows {
  /* */

  tool: PartialStagesType<ToolExecuteStage>;
  session: PartialStagesType<SessionHookStage>;
  auth: PartialStagesType<AuthHookStage>;
  'tool.call': PartialStagesType<ToolExecuteStage>;
}

export type FlowName = keyof FrontMcpHooksByStage;
