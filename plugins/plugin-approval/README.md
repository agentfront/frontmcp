# @frontmcp/plugin-approval

Tool authorization workflow with PKCE webhook security for FrontMCP.

## Features

- **Tool Approval Checking**: Automatic approval check before tool execution via hook
- **Multiple Approval Scopes**: SESSION, USER, TIME_LIMITED, TOOL_SPECIFIC, CONTEXT_SPECIFIC
- **PKCE Webhook Security**: RFC 7636 compliant PKCE for secure external approval systems
- **Recheck Mode**: Poll external API for approval status
- **Full Audit Trail**: Track who approved/revoked and when
- **Context Extension**: Use `this.approval` in tools

## Installation

```bash
npm install @frontmcp/plugin-approval
```

## Usage

### Basic Setup

```typescript
import { ApprovalPlugin } from '@frontmcp/plugin-approval';

// Create plugin with default settings
const plugin = ApprovalPlugin.init();

// Install into scope
await plugin.install(scope);
```

### With Webhook Mode

```typescript
const plugin = ApprovalPlugin.init({
  mode: 'webhook',
  webhook: {
    url: 'https://approval.example.com/webhook',
    challengeTtl: 300, // 5 minutes
    callbackPath: '/approval/callback',
  },
});
```

### Using in Tools

```typescript
import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'dangerous_operation',
  approval: {
    required: true,
    defaultScope: 'session',
    category: 'write',
    riskLevel: 'high',
    approvalMessage: 'Allow dangerous operation?',
  },
})
class DangerousTool extends ToolContext {
  async execute() {
    // This tool requires approval before execution
    // The approval hook automatically checks and throws ApprovalRequiredError if needed

    // You can also programmatically check/grant approvals:
    const approved = await this.approval.isApproved('other-tool');
    await this.approval.grantSessionApproval('helper-tool');
  }
}
```

### Approval Scopes

| Scope              | Description                                 |
| ------------------ | ------------------------------------------- |
| `SESSION`          | Valid for current session only              |
| `USER`             | Persists across sessions for the user       |
| `TIME_LIMITED`     | Expires after specified TTL                 |
| `TOOL_SPECIFIC`    | Specific to a particular tool               |
| `CONTEXT_SPECIFIC` | Specific to a context (repo, project, etc.) |

## Configuration Options

```typescript
interface ApprovalPluginOptions {
  // Storage configuration
  storage?: StorageConfig;
  storageInstance?: RootStorage | NamespacedStorage;
  namespace?: string; // default: 'approval'

  // Approval mode
  mode?: 'recheck' | 'webhook'; // default: 'recheck'

  // Recheck mode options
  recheck?: {
    url?: string;
    auth?: 'jwt' | 'bearer' | 'none' | 'custom';
    interval?: number;
    maxAttempts?: number;
  };

  // Webhook mode options
  webhook?: {
    url?: string;
    includeJwt?: boolean; // default: false (security)
    challengeTtl?: number; // seconds, default: 300
    callbackPath?: string; // default: '/approval/callback'
  };

  // Audit options
  enableAudit?: boolean; // default: true
  maxDelegationDepth?: number; // default: 3
  cleanupIntervalSeconds?: number; // default: 60
}
```

## PKCE Security (Webhook Mode)

When using webhook mode, ApprovalPlugin uses PKCE (RFC 7636) for secure authorization:

1. Generate PKCE pair: `code_verifier` (secret) + `code_challenge` (hash)
2. Store challenge in Redis: `challenge:{code_challenge}` → session info
3. Send to webhook: `{code_challenge, toolId, callbackUrl}` (NO session ID!)
4. External system calls back: `POST /approval/callback {code_verifier, approved}`
5. Plugin validates: `SHA256(code_verifier) === stored code_challenge`
6. Grant approval if valid

This ensures:

- Session ID is never exposed to external systems
- Challenge is single-use (deleted after callback)
- Challenge expires after TTL
- Only holder of `code_verifier` can complete approval

## License

Apache-2.0
