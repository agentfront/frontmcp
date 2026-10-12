# @frontmcp/uipack

`@frontmcp/uipack` is the React-free core FrontMCP builds widget pages with, on the server. It renders a tool's template into a full HTML page with a Content Security Policy, the call's data and the bridge script that talks to the host; resolves a widget's imports to CDN URLs; and bundles React widget files. `@frontmcp/sdk` depends on it, so a FrontMCP server already has it. Import it yourself to split a template into functions with `html`, to test a template without a server with `renderToolTemplate()`, or to build widget pages for a host of your own.

[![npm](https://img.shields.io/npm/v/@frontmcp/uipack.svg)](https://www.npmjs.com/package/@frontmcp/uipack) [![License](https://img.shields.io/npm/l/@frontmcp/uipack.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/uipack
```

- No React. The one runtime dependency is `zod`; npm 7 and later also install the peer `@frontmcp/lazy-zod`, at the same version.
- `esbuild` is an optional peer, needed only to bundle `.tsx` and `.jsx` widget files. Install it as a dependency, not a dev dependency, since it's loaded when a widget is rendered.
- It runs on Node.js 24 or later.

## Usage

Render a template the way a tool call does, without a server:

```ts
import { html, renderToolTemplate, type TemplateContext } from '@frontmcp/uipack';

type Weather = { city: string; tempC: number };

const badge = (text: string) => html`<span class="badge">${text}</span>`;

const result = renderToolTemplate({
  toolName: 'get_weather',
  input: { city: 'Oslo' },
  output: { city: 'Oslo', tempC: 21 },
  template: (ctx: TemplateContext<{ city: string }, Weather>) =>
    html`<h2>${ctx.output.city} ${badge(`${ctx.output.tempC}°C`)}</h2>`,
});
```

`result.html` is a whole HTML document whose body is `<h2>Oslo <span class="badge">21°C</span></h2>`, `result.uiType` is `"html"`, and `result.meta["ui/mimeType"]` is `"text/html;profile=mcp-app"`. Values interpolated into `html` are escaped, so a city of `<script>` renders as `&lt;script&gt;`; markup built with `html` or `trustedHtml()` isn't escaped twice. `html` is the same builder as a tool template's `ctx.helpers.html`, so pieces of a widget can live in their own file and be tested on their own ([Splitting a template into functions](https://frontmcp.dev/reference/ui/components#splitting-a-template-into-functions)).

### Building a page around your own markup

```ts
import { buildShell } from '@frontmcp/uipack/shell';

const { html, hash, size } = buildShell('<div id="root"></div>', {
  toolName: 'get_weather',
  input: { city: 'London' },
  output: { temp: 18 },
  includeBridge: true,
  csp: { connectDomains: ['https://api.weather.com'] },
});
```

`hash` is a short, non-cryptographic hash of the page, for cache keys, and `size` its length in bytes. The page looks like this, with the bridge script shortened:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net ... https://esm.sh; ... connect-src https://cdn.jsdelivr.net ... https://esm.sh https://api.weather.com; ..."
    />
    <script>
      window.__mcpAppsEnabled = true;
      window.__mcpToolName = 'get_weather';
      window.__mcpToolInput = { city: 'London' };
      window.__mcpToolOutput = { temp: 18 };
      window.__mcpStructuredContent = null;
    </script>
    <script>
      /* the bridge: picks an adapter for the host and sets window.FrontMcpBridge */
    </script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

### Resolving imports to CDN URLs

```ts
import { createEsmShResolver, rewriteImports } from '@frontmcp/uipack/resolver';

const resolver = createEsmShResolver({ providerOrder: ['cloudflare', 'jsdelivr'] });

resolver.resolve('chart.js');
// { value: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.1/chart.umd.min.js', type: 'url' }

rewriteImports("import { format } from 'date-fns';", { resolver }).code;
// "import { format } from 'https://esm.sh/date-fns';"
```

A package in the CDN registry (`react`, `react-dom`, `chart.js`, `d3`, `lodash`) resolves to its registered URL, trying the providers in `providerOrder`; any other package resolves to `https://esm.sh/<specifier>`.

### Rendering a component from npm

```ts
import { renderComponent } from '@frontmcp/uipack/component';

const { html } = renderComponent(
  { source: { npm: 'my-weather-widget', exportName: 'WeatherCard' } },
  { toolName: 'get_weather', output: { temp: 18 } },
);
```

`renderComponent()` is synchronous. The page imports the component from `https://esm.sh/my-weather-widget`, loads React from esm.sh through an import map, and renders the component into `#root` with the tool's output as its props. The source can be any of these:

| Source   | Shape                                                          | What happens                                                                                                         |
| -------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| npm      | `{ npm: 'my-chart', exportName?, version? }`                   | Loaded from its CDN registry entry, or from esm.sh.                                                                  |
| file     | `{ file: '/abs/path/widget.tsx', exportName?, inline? }`       | A local file. `.tsx` and `.jsx` files are bundled with esbuild; a relative path resolves from the working directory. |
| import   | `{ import: 'https://cdn.example.com/widget.js', exportName? }` | A module URL, used as it is.                                                                                         |
| function | `(input, output) => '<div>…</div>'`                            | Returns the HTML.                                                                                                    |

### Generating the bridge script

```ts
import { BRIDGE_SCRIPT_TAGS, generateBridgeIIFE } from '@frontmcp/uipack/bridge-runtime';

const everyHost = BRIDGE_SCRIPT_TAGS.universal;
const openAiOnly = `<script>${generateBridgeIIFE({ adapters: ['openai', 'generic'], minify: true })}</script>`;
```

The script detects the host and sets `window.FrontMcpBridge`:

| Member                                                                       | Description                                                                                  |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `adapterId`, `initialized`, `capabilities`                                   | The adapter picked for the host, whether it's ready, and what it can do.                     |
| `getToolInput()`, `getToolOutput()`, `getStructuredContent()`                | The call's data, from the page and then from each result the host sends.                     |
| `callTool(name, args)`                                                       | Calls a tool through the host and returns the host's result.                                 |
| `onToolResult(callback)`, `onContextChange(callback)`                        | Subscribe to results and to host changes. Each returns an unsubscribe function.              |
| `getTheme()`, `getDisplayMode()`, `getHostContext()`, `hasCapability(name)`  | What the host said about itself.                                                             |
| `sendMessage(text)`, `openLink(url)`                                         | Add a message to the conversation, open a link, through the host.                            |
| `requestDisplayMode(mode)`, `setSize({ width?, height? })`, `requestClose()` | Ask for `inline`, `fullscreen` or `pip`, report the widget's size, ask to remove the widget. |
| `updateModelContext(data, merge?)`                                           | Tell the host what the model should know, where the host supports it.                        |
| `getWidgetState()`, `setWidgetState(state)`                                  | State kept in `localStorage`.                                                                |

### Fetching TypeScript definitions

```ts
import { createTypeFetcher } from '@frontmcp/uipack/typings';

const fetcher = createTypeFetcher({ allowedPackages: ['@myorg/*'], maxDepth: 3 });
const { results, errors } = await fetcher.fetchBatch({ imports: ["import { z } from 'zod'"] });
// results[0].files: the .d.ts files, at virtual node_modules/ paths
```

It fetches the `.d.ts` files of each import from esm.sh, following their own imports up to `maxDepth` (default 2). Only allowed packages are fetched: `react`, `react-dom`, `react/jsx-runtime`, `zod` and `@frontmcp/*`, plus `allowedPackages`, or any package with `allowedPackages: false`.

## Entry points

`@frontmcp/uipack` exports everything below. Each module is also its own entry point:

| Import                            | What's in it                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `@frontmcp/uipack/adapters`       | `renderToolTemplate()`, `MCP_APPS_MIME_TYPE`, and the helpers the SDK uses to build a tool's widget response. |
| `@frontmcp/uipack/shell`          | `buildShell()`, `html`, `trustedHtml()`, template helpers, CSP, custom shells.                                |
| `@frontmcp/uipack/resolver`       | Import resolution, the CDN registry, import maps.                                                             |
| `@frontmcp/uipack/component`      | `renderComponent()` and the component sources.                                                                |
| `@frontmcp/uipack/bridge-runtime` | The bridge script generator.                                                                                  |
| `@frontmcp/uipack/typings`        | The `.d.ts` fetcher and its cache.                                                                            |
| `@frontmcp/uipack/types`          | Types for widget configuration, such as `UITemplateConfig` and `TemplateContext`.                             |
| `@frontmcp/uipack/utils`          | Escaping helpers.                                                                                             |

### Adapters

| Export                        | Description                                                                                                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderToolTemplate(options)` | Renders a template as a call does: `{ html, uiType, hash, size, meta }`. Options: `toolName`, `input`, `output`, `template`, `platformType?`, `resourceMode?`, `sizing?`, `csp?`, `escapeStringResults?`. |
| `MCP_APPS_MIME_TYPE`          | `"text/html;profile=mcp-app"`.                                                                                                                                                                            |

### Shell

| Export                                                                                               | Description                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildShell(content, config)`                                                                        | A page around `content`: `{ html, hash, size }`. `config`: `toolName` (required), `input`, `output`, `structuredContent`, `csp`, `includeBridge` (default `true`), `withShell` (default `true`; `false` returns the data script and the content only), `title`, `sizing`, `displayMode`, `customShell`. |
| `` html`…` ``, `trustedHtml(markup)`, `isTrustedHtml(value)`                                         | Build, mark and detect trusted markup. Values interpolated into `html` are escaped.                                                                                                                                                                                                                     |
| `createTemplateHelpers()`                                                                            | A new set of template helpers: `escapeHtml`, `formatDate`, `formatCurrency`, `uniqueId`, `jsonEmbed`, `html`, `trustedHtml`.                                                                                                                                                                            |
| `buildCSPDirectives(csp?)`, `buildCSPMetaTag(csp?)`                                                  | The page's policy: the default CDN origins plus `connectDomains` and `resourceDomains`.                                                                                                                                                                                                                 |
| `buildDataInjectionScript({ toolName, input?, output?, structuredContent?, sizing?, displayMode? })` | The `<script>` that sets `window.__mcpToolName`, `__mcpToolInput`, `__mcpToolOutput` and `__mcpStructuredContent`.                                                                                                                                                                                      |
| `resolveShellTemplate(source, options?)`                                                             | Async. Loads a custom shell from `{ inline }`, `{ url, timeout? }` or `{ npm, exportName?, version? }`, and validates it.                                                                                                                                                                               |
| `validateShellTemplate(template)`, `applyShellTemplate(template, values)`                            | Check and fill a custom shell's placeholders: `{{CONTENT}}` (required), `{{CSP}}`, `{{DATA}}`, `{{BRIDGE}}`, `{{TITLE}}`.                                                                                                                                                                               |
| `DEFAULT_CDN_DOMAINS`                                                                                | The origins every page allows: jsDelivr, cdnjs, Google Fonts and esm.sh.                                                                                                                                                                                                                                |

### Resolver

| Export                                                                                         | Description                                                                                       |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `createEsmShResolver({ registry?, providerOrder?, fallbackCdnBase? })`                         | The default resolver.                                                                             |
| `createResolverWithOverrides(overrides, options?)`                                             | The default resolver, with fixed URLs for some packages.                                          |
| `DEFAULT_CDN_REGISTRY`, `mergeRegistries(custom)`                                              | The registry (`react`, `react-dom`, `chart.js`, `d3`, `lodash`), and it merged with your entries. |
| `lookupPackage(name, registry?)`, `getPackageCDNUrl(name, providerOrder?, registry?)`          | Query the registry.                                                                               |
| `parseImports(source)`, `extractExternalPackages(source)`                                      | The imports in source code, and the packages they name.                                           |
| `rewriteImports(source, { resolver?, skipPackages?, overrides? })`                             | Replaces bare specifiers with CDN URLs: `{ code, rewrittenCount, rewrites, fallbackPackages }`.   |
| `createImportMap(dependencies)`, `mergeImportMaps(...maps)`, `generateImportMapScriptTag(map)` | Build, merge and write a browser import map.                                                      |

### Component

| Export                                                              | Description                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `renderComponent(config, shellConfig)`                              | Resolves `config.source` and builds the page around it: `{ html, hash, size }`. |
| `resolveUISource(source, options?)`                                 | Resolves a source to a `ResolvedComponent`.                                     |
| `generateMountScript(resolved, propsMapping?)`                      | The module script that imports and mounts a module component.                   |
| `bundleFileSource()`, `transpileReactSource()`                      | Bundle or transpile a `.tsx` or `.jsx` widget with esbuild.                     |
| `isNpmSource`, `isFileSource`, `isImportSource`, `isFunctionSource` | Type guards for the sources.                                                    |

### Bridge runtime

| Export                                       | Description                                                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `generateBridgeIIFE(options?)`               | The bridge script. Options: `adapters` (from `openai`, `ext-apps`, `claude`, `gemini`, `generic`), `debug`, `trustedOrigins`, `minify`. |
| `generatePlatformBundle(platform, options?)` | The script for `chatgpt`, `claude`, `gemini` or `universal`.                                                                            |
| `UNIVERSAL_BRIDGE_SCRIPT`                    | The script with every adapter.                                                                                                          |
| `BRIDGE_SCRIPT_TAGS`                         | `{ universal, chatgpt, claude, gemini }`, each wrapped in `<script>`.                                                                   |

### Typings

| Export                                                     | Description                                                                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `createTypeFetcher(options?, cache?)`                      | A `TypeFetcher`. Options: `allowedPackages`, `maxDepth`, `timeout` (10 s per request), `maxConcurrency` (5), `cdnBaseUrl`, `fetch`. |
| `TypeFetcher`                                              | `fetchBatch({ imports, maxDepth?, timeout? })`: `{ results, errors, totalTimeMs, cacheHits }`.                                      |
| `MemoryTypeCache`, `globalTypeCache`                       | A least-recently-used cache with expiry; the shared one keeps up to 500 entries for an hour.                                        |
| `parseDtsImports(content)`, `combineDtsContents(contents)` | Parse a `.d.ts` file's imports; join several files into one.                                                                        |

### Utils

| Export                         | Description                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `escapeHtml(value)`            | Escapes `&`, `<`, `>`, `"` and `'`, and U+2028 and U+2029. `null` and `undefined` give `''`.                                                                                         |
| `escapeHtmlAttr(value)`        | Escapes `&` and `"`, for attribute values.                                                                                                                                           |
| `escapeJsString(value)`        | Escapes a string for a JavaScript string literal.                                                                                                                                    |
| `escapeScriptClose(json)`      | Replaces `</` with `<\/`, so the text can't close a `<script>`.                                                                                                                      |
| `safeJsonForScript(value)`     | JSON safe to put in a `<script>`: `<`, `>` and `&` escaped, BigInt as a string, and `{"error":"Value could not be serialized"}` for a value JSON can't hold, such as a circular one. |
| `safeStringify(value, space?)` | `JSON.stringify` that writes `[Circular]` for circular references.                                                                                                                   |

## Docs

- [Widget components](https://frontmcp.dev/reference/ui/components): `@frontmcp/uipack` in a server, `html` and `renderToolTemplate()`
- [The `ui` option](https://frontmcp.dev/reference/ui): templates, serving modes, Content Security Policy
- [Hosts and platforms](https://frontmcp.dev/reference/ui/hosts): the bridge, `window.FrontMcpBridge`, and what each host gets
- [Choosing how a widget is served](https://frontmcp.dev/learn/choosing-how-a-widget-is-served): inline and static pages, and what a widget can load

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the server framework; it renders a tool's `ui` with this package.
- [`@frontmcp/ui`](https://www.npmjs.com/package/@frontmcp/ui): the React components, hooks and renderers for widget files.
- [`@frontmcp/testing`](https://www.npmjs.com/package/@frontmcp/testing): test helpers, with matchers for a tool's rendered widget.

## Contributing

Source: [`libs/uipack`](https://github.com/agentfront/frontmcp/tree/main/libs/uipack). Issues and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

The source has one folder per entry point under `src/`: `adapters/`, `shell/`, `resolver/`, `component/`, `bridge-runtime/`, `typings/`, `types/` and `utils/`. `utils` and `bridge-runtime` depend on nothing else; `resolver` uses `utils`; `shell` uses `utils`, `resolver` and `bridge-runtime`; `component` builds on `shell`; `adapters` uses them all; `typings` stands alone, and `types` only imports types. Test escaping and Content Security Policy changes with hostile input. In the monorepo:

```bash
nx build uipack
nx test uipack
nx lint uipack
```

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
