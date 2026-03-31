---
name: remember-plugin-session-memory
reference: official-plugins
level: basic
description: 'Demonstrates installing the Remember plugin and using `this.remember` in tools to store and retrieve session memory.'
tags: [development, session, plugins, remember, plugin, memory]
features:
  - "Installing `RememberPlugin` with `type: 'memory'` for development"
  - 'Enabling `tools: { enabled: true }` to expose LLM-callable memory tools (`remember_this`, `recall`, etc.)'
  - 'Using `this.remember.set()` with default `session` scope and explicit `user` scope'
  - 'Using `this.remember.get()` with a `defaultValue` fallback'
  - 'Using `this.remember.knows()` to check key existence without retrieving the value'
---

# Remember Plugin for Session Memory

Demonstrates installing the Remember plugin and using `this.remember` in tools to store and retrieve session memory.

## Code

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';
import RememberPlugin from '@frontmcp/plugin-remember';

@App({ name: 'my-app', tools: [PreferencesTool, GreetingTool] })
class MyApp {}

@FrontMcp({
  info: { name: 'memory-server', version: '1.0.0' },
  apps: [MyApp],
  plugins: [
    RememberPlugin.init({
      type: 'memory',
      tools: { enabled: true },
    }),
  ],
})
class MyServer {}
```

```typescript
// src/tools/preferences.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'set_preferences',
  description: 'Save user preferences for the session',
  inputSchema: {
    theme: z.enum(['light', 'dark']).describe('UI theme preference'),
    language: z.string().describe('Preferred language code'),
  },
})
class PreferencesTool extends ToolContext {
  async execute(input: { theme: string; language: string }) {
    await this.remember.set('theme', input.theme);
    await this.remember.set('language', input.language, { scope: 'user' });

    return { saved: true, theme: input.theme, language: input.language };
  }
}
```

```typescript
// src/tools/greeting.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'get_greeting',
  description: 'Get a personalized greeting using remembered preferences',
  inputSchema: {
    name: z.string().describe('User name'),
  },
})
class GreetingTool extends ToolContext {
  async execute(input: { name: string }) {
    const theme = await this.remember.get('theme', { defaultValue: 'light' });
    const language = await this.remember.get('language', { defaultValue: 'en' });
    const hasOnboarded = await this.remember.knows('onboarding_complete');

    return {
      greeting: `Hello ${input.name}!`,
      theme,
      language,
      showOnboarding: !hasOnboarded,
    };
  }
}
```

## What This Demonstrates

- Installing `RememberPlugin` with `type: 'memory'` for development
- Enabling `tools: { enabled: true }` to expose LLM-callable memory tools (`remember_this`, `recall`, etc.)
- Using `this.remember.set()` with default `session` scope and explicit `user` scope
- Using `this.remember.get()` with a `defaultValue` fallback
- Using `this.remember.knows()` to check key existence without retrieving the value

## Related

- See `official-plugins` for Redis storage, Vercel KV, memory scopes, and all Remember API methods
- See `create-plugin-hooks` for building custom plugins with lifecycle hooks
