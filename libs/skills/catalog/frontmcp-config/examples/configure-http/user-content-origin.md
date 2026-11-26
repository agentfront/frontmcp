---
name: user-content-origin
reference: configure-http
level: intermediate
description: 'Serve user content (rendered frames, uploads) from a second listener on an origin of its own, with its own Host check and CSP.'
tags: [config, http, user-content, static, csp, origin, security]
features:
  - 'Opening a second listener with `http.userContent` that starts and stops with the server'
  - 'Serving static files from a directory, on a port the MCP endpoint never shares'
  - 'Checking `Host` against the content origin with `allowedHosts`'
  - 'Sending a content security policy and headers of its own, apart from the MCP listener'
---

# User Content on an Origin of Its Own

Serve user content (rendered frames, uploads) from a second listener on an origin of its own, with its own Host check and CSP.

## Code

```typescript
// src/server.ts
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

const CONTENT_DIR = path.resolve('var/frames');
const CONTENT_ORIGIN = process.env['CONTENT_ORIGIN'] ?? 'http://localhost:3001';

@Tool({
  name: 'render_frame',
  description: 'Render a frame and return the URL it is served at',
  inputSchema: { id: z.string().regex(/^[a-z0-9-]+$/), html: z.string() },
})
class RenderFrameTool extends ToolContext {
  async execute({ id, html }: { id: string; html: string }) {
    await writeFile(path.join(CONTENT_DIR, `${id}.html`), html);
    return { url: `${CONTENT_ORIGIN}/${id}.html` };
  }
}

@App({ name: 'frames', tools: [RenderFrameTool] })
class FramesApp {}

@FrontMcp({
  info: { name: 'frames-server', version: '1.0.0' },
  apps: [FramesApp],
  http: {
    port: 3000,
    userContent: {
      port: 3001,
      root: CONTENT_DIR,
      // Behind a proxy, name the content hostname; on a loopback bind the loopback names are derived.
      allowedHosts: ['content.example.com', 'localhost:3001'],
      headers: { 'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': 'no-store' },
      csp: {
        directives: {
          'default-src': "'none'",
          'img-src': ["'self'", 'data:'],
          'style-src': "'unsafe-inline'",
          'frame-ancestors': ['https://app.example.com'],
        },
      },
    },
  },
})
class Server {}
```

## What This Demonstrates

- Opening a second listener with `http.userContent` that starts and stops with the server
- Serving static files from a directory, on a port the MCP endpoint never shares
- Checking `Host` against the content origin with `allowedHosts`
- Sending a content security policy and headers of its own, apart from the MCP listener

## Related

- See `configure-http` for the full HTTP configuration reference
- See `configure-security-headers` for the MCP listener's own headers
