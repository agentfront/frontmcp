# @frontmcp/plugin-remember

Remember plugin for FrontMCP - provides encrypted session memory with an approval system for secure tool authorization.

## Installation

```bash
npm install @frontmcp/plugin-remember
```

## Usage

```typescript
import { RememberPlugin } from '@frontmcp/plugin-remember';
import { FrontMcp } from '@frontmcp/sdk';

const app = new FrontMcp({
  plugins: [RememberPlugin],
});
```

## Features

- **Encrypted Memory**: Store and retrieve values with AES-256-GCM encryption
- **Scoped Storage**: Session, user, tool, and global scopes
- **Approval System**: Tool approval workflow with configurable requirements
- **TTL Support**: Automatic expiration of stored values
- **Multiple Backends**: Redis, Vercel KV, or in-memory storage

## Usage in Tools

```typescript
@Tool({ name: 'my_tool' })
class MyTool extends ToolContext {
  async execute(input) {
    // Store a value
    await this.remember.set('theme', 'dark');

    // Retrieve a value
    const theme = await this.remember.get('theme', { defaultValue: 'light' });

    // Store with TTL (expires in 5 minutes)
    await this.remember.set('token', 'xyz', { ttl: 300 });

    // Check if remembered
    if (await this.remember.knows('onboarded')) {
      // Skip onboarding
    }
  }
}
```

## Configuration

```typescript
import { RememberPlugin } from '@frontmcp/plugin-remember';

const app = new FrontMcp({
  plugins: [
    RememberPlugin.configure({
      store: 'redis',
      encryption: { enabled: true },
      approval: { enabled: true },
    }),
  ],
});
```

## License

Apache-2.0
