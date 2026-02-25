import 'reflect-metadata';
import { extendedWorkflowMetadata, FrontMcpWorkflowTokens } from '../tokens';
import { WorkflowMetadata, frontMcpWorkflowMetadataSchema } from '../metadata/workflow.metadata';

/**
 * Decorator that marks a class as a Workflow and provides metadata.
 */
function FrontMcpWorkflow(providedMetadata: WorkflowMetadata): ClassDecorator {
  return (target: any) => {
    const metadata = frontMcpWorkflowMetadataSchema.parse(providedMetadata);
    Reflect.defineMetadata(FrontMcpWorkflowTokens.type, true, target);
    const extended = {};
    for (const property in metadata) {
      if (FrontMcpWorkflowTokens[property]) {
        Reflect.defineMetadata(FrontMcpWorkflowTokens[property], metadata[property], target);
      } else {
        extended[property] = metadata[property];
      }
    }
    Reflect.defineMetadata(extendedWorkflowMetadata, extended, target);
  };
}

/**
 * Function builder for creating workflows declaratively.
 */
function frontMcpWorkflow(providedMetadata: WorkflowMetadata): () => void {
  const metadata = frontMcpWorkflowMetadataSchema.parse(providedMetadata);
  const workflowFunction = function () {
    return metadata;
  };
  Object.assign(workflowFunction, {
    [FrontMcpWorkflowTokens.type]: 'value-workflow',
    [FrontMcpWorkflowTokens.metadata]: metadata,
  });
  return workflowFunction;
}

export { FrontMcpWorkflow, FrontMcpWorkflow as Workflow, frontMcpWorkflow, frontMcpWorkflow as workflow };
