---
name: destructive-delete-tool
reference: create-tool-annotations
level: intermediate
description: 'Demonstrates annotating a tool that deletes data, enabling MCP clients to warn users before execution.'
tags: [development, elicitation, tool, annotations, destructive, delete]
features:
  - 'Setting `destructiveHint: true` on the delete tool so MCP clients can trigger confirmation warnings'
  - 'Setting `idempotentHint: true` on the delete tool because deleting the same user twice produces the same outcome'
  - 'Setting `openWorldHint: true` on the email tool because it interacts with an external SMTP service'
  - 'Setting `idempotentHint: false` on the email tool because each call sends a new email'
  - 'How different annotation combinations express different behavioral contracts'
---

# Destructive Delete Tool with Annotations

Demonstrates annotating a tool that deletes data, enabling MCP clients to warn users before execution.

## Code

```typescript
// src/tools/delete-user.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'delete_user',
  description: 'Permanently delete a user account and all associated data',
  inputSchema: {
    userId: z.string().describe('ID of the user to delete'),
    confirm: z.boolean().describe('Must be true to confirm deletion'),
  },
  annotations: {
    title: 'Delete User Account',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
})
class DeleteUserTool extends ToolContext {
  async execute(input: { userId: string; confirm: boolean }) {
    if (!input.confirm) {
      return { deleted: false, reason: 'Confirmation required' };
    }
    const db = this.get(DatabaseToken);
    await db.deleteUser(input.userId);
    return { deleted: true, userId: input.userId };
  }
}
```

```typescript
// src/tools/send-email.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'send_email',
  description: 'Send an email to a recipient via external SMTP service',
  inputSchema: {
    to: z.string().email().describe('Recipient email address'),
    subject: z.string().describe('Email subject'),
    body: z.string().describe('Email body text'),
  },
  annotations: {
    title: 'Send Email',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
})
class SendEmailTool extends ToolContext {
  async execute(input: { to: string; subject: string; body: string }) {
    const mailer = this.get(MailerToken);
    const result = await mailer.send(input.to, input.subject, input.body);
    return { sent: true, messageId: result.id };
  }
}
```

## What This Demonstrates

- Setting `destructiveHint: true` on the delete tool so MCP clients can trigger confirmation warnings
- Setting `idempotentHint: true` on the delete tool because deleting the same user twice produces the same outcome
- Setting `openWorldHint: true` on the email tool because it interacts with an external SMTP service
- Setting `idempotentHint: false` on the email tool because each call sends a new email
- How different annotation combinations express different behavioral contracts

## Related

- See `create-tool-annotations` for all annotation fields and their default values
- See `decorators-guide` for the full `@Tool` decorator field reference
