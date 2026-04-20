---
name: zod-raw-shape-output
reference: create-tool-output-schema-types
level: basic
description: 'Demonstrates the recommended approach of using a Zod raw shape as `outputSchema` for structured, validated JSON output.'
tags: [development, codecall, output-schema, tool, output, schema]
features:
  - 'Using a Zod raw shape (plain object with Zod types) as `outputSchema` for structured output'
  - 'The output is validated at runtime against the schema before being returned to the client'
  - 'This is the recommended pattern for CodeCall compatibility and data leak prevention'
  - 'The `execute()` return type is automatically inferred from the output schema'
---

# Zod Raw Shape Output Schema

Demonstrates the recommended approach of using a Zod raw shape as `outputSchema` for structured, validated JSON output.

## Code

```typescript
// src/tools/get-user-profile.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'get_user_profile',
  description: 'Retrieve a user profile by ID',
  inputSchema: {
    userId: z.string().describe('The user ID to look up'),
  },
  outputSchema: {
    name: z.string(),
    email: z.string().email(),
    age: z.number(),
    roles: z.array(z.string()),
    active: z.boolean(),
  },
})
class GetUserProfileTool extends ToolContext {
  async execute(input: { userId: string }) {
    const db = this.get(DatabaseToken);
    const user = await db.findUser(input.userId);
    return {
      name: user.name,
      email: user.email,
      age: user.age,
      roles: user.roles,
      active: user.active,
    };
  }
}
```

## What This Demonstrates

- Using a Zod raw shape (plain object with Zod types) as `outputSchema` for structured output
- The output is validated at runtime against the schema before being returned to the client
- This is the recommended pattern for CodeCall compatibility and data leak prevention
- The `execute()` return type is automatically inferred from the output schema

## Related

- See `create-tool-output-schema-types` for all supported output schema formats
