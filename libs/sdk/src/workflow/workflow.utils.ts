import { getMetadata, isClass } from '@frontmcp/di';
import { internalZ as z } from '@frontmcp/lazy-zod';

import { type WorkflowEntry } from '../common/entries/workflow.entry';
import { type WorkflowType } from '../common/interfaces/workflow.interface';
import { type WorkflowMetadata } from '../common/metadata/workflow.metadata';
import { WorkflowKind, type WorkflowRecord } from '../common/records/workflow.record';
import { extendedWorkflowMetadata, FrontMcpWorkflowTokens } from '../common/tokens/workflow.tokens';
import { InvalidEntityError, InvalidInputError } from '../errors';

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

/**
 * A run's input as the workflow's `inputSchema` parses it, or as given when it has none.
 *
 * @throws InvalidInputError (`INVALID_INPUT`) when the input doesn't match the schema
 */
export function parseWorkflowInput(
  workflow: WorkflowEntry,
  input: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const shape = workflow.metadata.inputSchema;
  if (!shape) return input ?? {};
  const parsed = z.object(shape).safeParse(input ?? {});
  if (!parsed.success) {
    throw new InvalidInputError(`Invalid input for workflow "${workflow.name}"`, parsed.error.issues);
  }
  return parsed.data;
}
