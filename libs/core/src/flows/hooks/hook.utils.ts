import {FlowMetadata, FlowType, FrontMcpFlowTokens} from "@frontmcp/sdk";
import {getMetadata} from "../../utils/metadata.utils";

export function collectHookMetadata(cls: FlowType): FlowMetadata<never> {
  return Object.entries(FrontMcpFlowTokens).reduce((metadata, [key, token]) => {
    return Object.assign(metadata, {
      [key]: getMetadata(token, cls),
    });
  }, {} as FlowMetadata<never>);
}

