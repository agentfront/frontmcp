import { Resource, ResourceTemplate, ResourceContext } from '@frontmcp/react';

// ─── App Info Resource ───────────────────────────────────────────────────────

@Resource({
  name: 'app-info',
  uri: 'app://info',
  description: 'Application metadata and runtime info',
  mimeType: 'application/json',
})
export class AppInfoResource extends ResourceContext {
  async execute(uri: string) {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              name: 'FrontMCP Browser Demo (React)',
              version: '1.0.0',
              runtime: 'browser',
              userAgent: navigator.userAgent,
              timestamp: new Date().toISOString(),
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}

// ─── Notes Resource Template ─────────────────────────────────────────────────

const notesStore: Record<string, { id: string; title: string; body: string }> = {
  '1': {
    id: '1',
    title: 'Getting Started',
    body: 'FrontMCP runs natively in the browser with in-memory transport.',
  },
  '2': {
    id: '2',
    title: 'Architecture',
    body: 'The SDK uses decorators, DI, and flows to build MCP-compliant servers.',
  },
  '3': {
    id: '3',
    title: 'Browser Support',
    body: 'Browser builds externalize zod and reflect-metadata via import maps.',
  },
};

@ResourceTemplate({
  name: 'note',
  uriTemplate: 'notes://notes/{id}',
  description: 'Read a note by ID (available: 1, 2, 3)',
  mimeType: 'application/json',
})
export class NoteResource extends ResourceContext<{ id: string }> {
  async execute(uri: string, params: { id: string }) {
    const note = notesStore[params.id];
    if (!note) {
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              error: `Note '${params.id}' not found. Available IDs: ${Object.keys(notesStore).join(', ')}`,
            }),
          },
        ],
      };
    }
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(note, null, 2),
        },
      ],
    };
  }
}
