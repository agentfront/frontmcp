import type { ReadResourceResult } from '@frontmcp/protocol';

import { ResourceContext } from '../../common/interfaces/resource.interface';
import type { ResourceMetadata } from '../../common/metadata/resource.metadata';
import { InvalidResourceStoreError } from '../../errors/mcp.error';

/** The `_meta` key of a materialized resource's read: `{ revision, updatedAt? }` of the value it served. */
export const MATERIALIZED_META_KEY = 'frontmcp/materialized';

/**
 * The context of a resource that serves its `from` key as it is stored: a string as `text/plain`, anything else as
 * JSON (the resource's `mimeType` wins when set), with the revision and time in `_meta['frontmcp/materialized']`.
 */
export class MaterializedResourceContext extends ResourceContext<Record<string, string>, ReadResourceResult> {
  async execute(): Promise<ReadResourceResult> {
    const from = (this.metadata as ResourceMetadata).from;
    if (!from) throw new InvalidResourceStoreError(missingKeyMessage(this.metadata.name));
    const { value, revision, updatedAt } = await from.get();
    const isText = typeof value === 'string';
    return {
      contents: [
        {
          uri: this.uri,
          mimeType: this.metadata.mimeType ?? (isText ? 'text/plain' : 'application/json'),
          text: isText ? value : JSON.stringify(value ?? null),
        },
      ],
      _meta: { [MATERIALIZED_META_KEY]: updatedAt === undefined ? { revision } : { revision, updatedAt } },
    };
  }
}

export function missingKeyMessage(resourceName: string): string {
  return `resource "${resourceName}" extends MaterializedResourceContext but declares no \`from\` key`;
}
