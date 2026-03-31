---
name: parameterized-template
reference: create-resource
level: intermediate
description: 'A resource template with typed URI parameters and argument autocompletion.'
tags: [development, resource, parameterized, template]
features:
  - 'Using `@ResourceTemplate` with `uriTemplate` containing `{param}` placeholders'
  - 'Typing the `ResourceContext` generic parameter for compile-time parameter checking'
  - 'Implementing a convention-based completer (`userIdCompleter`) for argument autocompletion'
  - 'Accessing DI providers via `this.get()` in both `execute()` and completer methods'
---

# Parameterized Resource Template

A resource template with typed URI parameters and argument autocompletion.

## Code

```typescript
// src/apps/main/resources/user-profile.resource.ts
import { ResourceTemplate, ResourceContext } from '@frontmcp/sdk';
import type { ResourceCompletionResult } from '@frontmcp/sdk';
import { ReadResourceResult } from '@frontmcp/protocol';
import type { Token } from '@frontmcp/di';

interface UserService {
  findById(id: string): Promise<{ id: string; name: string; email: string }>;
  search(partial: string): Promise<Array<{ id: string; name: string }>>;
}

const USER_SERVICE: Token<UserService> = Symbol('UserService');

@ResourceTemplate({
  name: 'user-profile',
  uriTemplate: 'users://{userId}/profile',
  description: 'User profile by ID',
  mimeType: 'application/json',
})
class UserProfileResource extends ResourceContext<{ userId: string }> {
  async execute(uri: string, params: { userId: string }): Promise<ReadResourceResult> {
    const user = await this.get(USER_SERVICE).findById(params.userId);

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(user),
        },
      ],
    };
  }

  async userIdCompleter(partial: string): Promise<ResourceCompletionResult> {
    const users = await this.get(USER_SERVICE).search(partial);
    return { values: users.map((u) => u.id), total: users.length };
  }
}
```

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

@App({
  name: 'main',
  providers: [UserServiceProvider],
  resources: [UserProfileResource],
})
class MainApp {}
```

## What This Demonstrates

- Using `@ResourceTemplate` with `uriTemplate` containing `{param}` placeholders
- Typing the `ResourceContext` generic parameter for compile-time parameter checking
- Implementing a convention-based completer (`userIdCompleter`) for argument autocompletion
- Accessing DI providers via `this.get()` in both `execute()` and completer methods

## Related

- See `create-resource` for binary blob content, multiple content items, and function-style builders
- See `create-provider` for implementing the `UserServiceProvider`
