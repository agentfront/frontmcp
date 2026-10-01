// An ES-module project ("type": "module") that runs on the built @frontmcp packages: Node loads
// their ESM bundles, which is where a lazy require() failed with "Dynamic require of "path" is
// not supported" (#681). One tool has a .tsx widget; with AUTH=1 the server also serves a custom
// auth.ui login page. Both are compiled from .tsx by @frontmcp/uipack when they are requested.
import 'reflect-metadata';

import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { App, FrontMcp, LogLevel, tool } from '@frontmcp/sdk';

const here = (file) => fileURLToPath(new URL(file, import.meta.url));

const greet = tool({
  name: 'greet',
  description: 'Greets someone',
  inputSchema: { name: z.string() },
  ui: { template: { file: here('./widget.tsx') } },
})((input) => ({ greeting: `Hello, ${input.name}` }));

class GreetingsApp {}
App({ id: 'greetings', name: 'greetings', tools: [greet] })(GreetingsApp);

const auth =
  process.env.AUTH === '1'
    ? {
        mode: 'local',
        requireRegisteredClients: false,
        tokenStorage: 'memory',
        allowDefaultPublic: false,
        anonymousScopes: ['anonymous'],
        requireEmail: false,
        anonymousSubject: 'local-operator',
        ui: { login: here('./login.tsx') },
      }
    : undefined;

class Server {}
FrontMcp({
  info: { name: 'esm-project', version: '0.0.1' },
  apps: [GreetingsApp],
  logging: { level: LogLevel.Warn },
  http: { port: Number(process.env.PORT ?? 3990) },
  ...(auth ? { auth } : {}),
})(Server);
