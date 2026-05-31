---
name: 04-tool-with-zod-schema-output
level: advanced
description: 'Tool returning a discriminated union via a full `z.discriminatedUnion(...)` outputSchema — for outputs that branch on a kind field.'
tags: [output-schema, zod-schema, discriminated-union]
features:
  - 'Using a full Zod schema (`z.discriminatedUnion(...)`) as `outputSchema` instead of a raw shape'
  - 'Branching the runtime output on a discriminant `kind` literal'
  - 'Letting TypeScript narrow the return type per branch (via `as const` on the discriminant)'
  - 'Knowing when full Zod schemas are the right pick (unions, transforms) and when a raw shape is enough'
---

# Tool With Zod Schema Output

Tool returning a discriminated union via a full `z.discriminatedUnion(...)` outputSchema — for outputs that branch on a kind field.

When the output has more than one shape (e.g. `user` vs `group`), use a full Zod schema instead of a raw shape. `z.discriminatedUnion` is the cleanest pattern.

## Code

```typescript
// src/apps/main/tools/resolve-principal.schema.ts
import { ToolInputOf, ToolOutputOf, z } from '@frontmcp/sdk';

export const inputSchema = {
  handle: z.string().describe('A user or group handle, e.g. `@ada` or `#engineering`'),
};

// Full Zod schema — discriminated union on `kind`.
export const outputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user'),
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
  }),
  z.object({
    kind: z.literal('group'),
    id: z.string(),
    name: z.string(),
    memberCount: z.number().int().min(0),
  }),
]);

export type ResolvePrincipalInput = ToolInputOf<{ inputSchema: typeof inputSchema }>;
export type ResolvePrincipalOutput = ToolOutputOf<{ outputSchema: typeof outputSchema }>;
```

```typescript
// src/apps/main/tools/resolve-principal.tool.ts
import { PublicMcpError, Tool, ToolContext } from '@frontmcp/sdk';

import { PRINCIPALS } from '../tokens';
import {
  inputSchema,
  outputSchema,
  type ResolvePrincipalInput,
  type ResolvePrincipalOutput,
} from './resolve-principal.schema';

@Tool({
  name: 'resolve_principal',
  description: 'Resolve a handle to a user or group',
  inputSchema,
  outputSchema,
})
export class ResolvePrincipalTool extends ToolContext {
  async execute(input: ResolvePrincipalInput): Promise<ResolvePrincipalOutput> {
    const svc = this.get(PRINCIPALS);
    if (input.handle.startsWith('@')) {
      const user = await svc.findUserByHandle(input.handle.slice(1));
      return { kind: 'user' as const, id: user.id, name: user.name, email: user.email };
    }
    if (input.handle.startsWith('#')) {
      const group = await svc.findGroupBySlug(input.handle.slice(1));
      return { kind: 'group' as const, id: group.id, name: group.name, memberCount: group.members.length };
    }
    this.fail(new PublicMcpError(`Unknown handle prefix: ${input.handle[0]}`));
  }
}
```

## What This Demonstrates

- Using a full Zod schema (`z.discriminatedUnion(...)`) as `outputSchema` instead of a raw shape
- Branching the runtime output on a discriminant `kind` literal
- Letting TypeScript narrow the return type per branch (via `as const` on the discriminant)
- Knowing when full Zod schemas are the right pick (unions, transforms) and when a raw shape is enough

## When to use a full Zod schema for output

| Use raw shape                            | Use full Zod schema                                      |
| ---------------------------------------- | -------------------------------------------------------- |
| Single object with a fixed set of fields | Union of multiple shapes (`z.discriminatedUnion`)        |
| All fields known statically              | Arrays of complex objects (`z.array(z.object(...))`)     |
| No transforms / refinements needed       | Need `z.transform(...)`, `z.refine(...)`, `z.brand(...)` |
| Default and recommended                  | When the raw shape can't express the contract            |
