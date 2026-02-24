import { isClass, getMetadata } from '@frontmcp/di';
import { InvalidEntityError } from '../errors';
import { WorkflowMetadata } from '../common/metadata/workflow.metadata';
import { FrontMcpWorkflowTokens, extendedWorkflowMetadata } from '../common/tokens/workflow.tokens';
import { WorkflowRecord, WorkflowKind } from '../common/records/workflow.record';
import { WorkflowType } from '../common/interfaces/workflow.interface';

export function collectWorkflowMetadata(cls: WorkflowType): WorkflowMetadata {
  const extended = getMetadata(extendedWorkflowMetadata, cls);
  const seed = (extended ? { ...extended } : {}) as WorkflowMetadata;
  return Object.entries(FrontMcpWorkflowTokens).reduce((metadata, [key, token]) => {
    const value = getMetadata(token, cls);
    if (value !== undefined) {
      return Object.assign(metadata, {
        [key]: value,
      });
    } else {
      return metadata;
    }
  }, seed);
}

export function normalizeWorkflow(item: unknown): WorkflowRecord {
  // Value-style workflow
  if (
    item &&
    typeof item === 'function' &&
    item[FrontMcpWorkflowTokens.type] === 'value-workflow' &&
    item[FrontMcpWorkflowTokens.metadata]
  ) {
    const metadata = item[FrontMcpWorkflowTokens.metadata] as WorkflowMetadata;
    return {
      kind: WorkflowKind.VALUE,
      provide: Symbol.for(`workflow:${metadata.name}`),
      metadata,
    };
  }

  // Class-style workflow
  if (isClass(item)) {
    const metadata = collectWorkflowMetadata(item);
    return { kind: WorkflowKind.CLASS_TOKEN, provide: item, metadata };
  }

  const name =
    (item != null && typeof item === 'object' && 'name' in item ? (item as { name: string }).name : undefined) ??
    String(item);
  throw new InvalidEntityError('workflow', name, 'a class or a workflow object');
}
