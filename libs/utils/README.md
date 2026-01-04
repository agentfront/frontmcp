# @frontmcp/utils

Shared utility functions for the FrontMCP ecosystem. Provides generic, protocol-neutral utilities for string manipulation, URI handling, path operations, content processing, and more.

## Installation

```bash
npm install @frontmcp/utils
# or
yarn add @frontmcp/utils
```

## Features

### Naming Utilities

```typescript
import { splitWords, toCase, shortHash, ensureMaxLen, idFromString } from '@frontmcp/utils';

// Split strings into words (handles camelCase, PascalCase, delimiters)
splitWords('myFunctionName'); // ['my', 'Function', 'Name']

// Convert to different cases
toCase(['my', 'function'], 'snake'); // 'my_function'
toCase(['my', 'function'], 'kebab'); // 'my-function'
toCase(['my', 'function'], 'camel'); // 'myFunction'

// Generate short hashes
shortHash('some-string'); // '6-char hex hash'

// Truncate with hash for uniqueness
ensureMaxLen('very-long-name-that-exceeds-limit', 20);

// Sanitize to valid ID
idFromString('My Function Name!'); // 'My-Function-Name'
```

### URI Utilities

```typescript
import {
  isValidMcpUri,
  extractUriScheme,
  parseUriTemplate,
  matchUriTemplate,
  expandUriTemplate,
} from '@frontmcp/utils';

// Validate RFC 3986 URIs
isValidMcpUri('https://example.com/resource'); // true
isValidMcpUri('/path/without/scheme'); // false

// Extract scheme
extractUriScheme('https://example.com'); // 'https'

// RFC 6570 URI Templates
const params = matchUriTemplate('users/{userId}/posts/{postId}', 'users/123/posts/456');
// { userId: '123', postId: '456' }

expandUriTemplate('users/{userId}', { userId: '123' }); // 'users/123'
```

### Path Utilities

```typescript
import { trimSlashes, joinPath } from '@frontmcp/utils';

trimSlashes('/path/to/resource/'); // 'path/to/resource'
joinPath('api', 'v1', 'users'); // '/api/v1/users'
```

### Content Utilities

```typescript
import { sanitizeToJson, inferMimeType } from '@frontmcp/utils';

// Sanitize values to JSON-safe objects
sanitizeToJson({ date: new Date(), fn: () => {} }); // { date: '2024-01-01T00:00:00.000Z' }

// Infer MIME type from extension
inferMimeType('document.json'); // 'application/json'
inferMimeType('image.png'); // 'image/png'
```

### HTTP Utilities

```typescript
import { validateBaseUrl } from '@frontmcp/utils';

// Validate and normalize URLs
const url = validateBaseUrl('https://api.example.com');
// Throws for invalid URLs or unsupported protocols (file://, javascript:)
```

### File System Utilities

```typescript
import { fileExists, readJSON, writeJSON, ensureDir, isDirEmpty } from '@frontmcp/utils';

// Async file operations
await fileExists('/path/to/file');
await readJSON<Config>('/path/to/config.json');
await writeJSON('/path/to/output.json', { key: 'value' });
await ensureDir('/path/to/directory');
await isDirEmpty('/path/to/directory');
```

## License

Apache-2.0
