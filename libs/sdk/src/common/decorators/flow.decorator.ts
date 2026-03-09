import { FlowMetadata, FlowName, frontMcpFlowMetadataSchema } from '../metadata';
import { FrontMcpFlowTokens } from '../tokens';

/**
 * Decorator that marks a class as a FrontMcpFlow module and provides metadata
 */
function FrontMcpFlow<Name extends FlowName>(providedMetadata: FlowMetadata<Name>): ClassDecorator {
  return (target: any) => {
    const metadata = frontMcpFlowMetadataSchema.parse(providedMetadata);

    Reflect.defineMetadata(FrontMcpFlowTokens.type, true, target);

    for (const property in metadata) {
      Reflect.defineMetadata(FrontMcpFlowTokens[property] ?? property, metadata[property], target);
    }
  };
}

export { FrontMcpFlow, FrontMcpFlow as Flow };
