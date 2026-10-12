# @frontmcp/adapters

Adapters for FrontMCP servers. An adapter builds tools from another source when the server starts. This package has `OpenapiAdapter`, which reads an OpenAPI 3 description of a REST API and gives your app one tool per operation, so you can put an API you already have in front of a model without writing a tool for each endpoint.

[![npm](https://img.shields.io/npm/v/@frontmcp/adapters.svg)](https://www.npmjs.com/package/@frontmcp/adapters) [![License](https://img.shields.io/npm/l/@frontmcp/adapters.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/adapters
```

Use it in a FrontMCP app: it depends on `@frontmcp/sdk`, so keep the two at the same version. It needs Node.js 24 or later.

## Usage

List the result of `OpenapiAdapter.init()` in an app's `adapters`:

```ts
import { OpenapiAdapter } from '@frontmcp/adapters';
import { App } from '@frontmcp/sdk';

@App({
  id: 'petstore',
  name: 'Pet Store',
  adapters: [
    OpenapiAdapter.init({
      name: 'petstore',
      url: 'https://petstore3.swagger.io/api/v3/openapi.json',
      baseUrl: 'https://petstore3.swagger.io/api/v3',
    }),
  ],
})
export class PetStoreApp {}
```

Required options:

| Option              | Type                 | Description                                                                                                             |
| ------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `name`              | `string`             | Names the adapter. It must be unique in the process, and prefixes a tool whose name clashes with another tool's.        |
| `baseUrl`           | `string`             | Where the API is. Each operation's path is appended to it, and it wins over the spec's `servers`.                       |
| `spec` **or** `url` | `object` or `string` | The OpenAPI 3.0 or 3.1 document as an object, or an `http:` or `https:` URL to download it from when the server starts. |

Each tool checks its arguments against the operation's parameters and body schema before it sends the request. Other options set credentials (`staticAuth`, `authProviderMapper`, `securityResolver`), filter and rename operations (`generateOptions`, `toolTransforms`), fill in inputs on the server (`inputTransforms`), reshape responses (`dataTransforms`), and re-read the spec while the server runs (`polling`). [OpenAPI adapter](https://frontmcp.dev/reference/adapters/openapi) documents every option.

Parsing the spec and generating the tools is done by [`mcp-from-openapi`](https://www.npmjs.com/package/mcp-from-openapi).

### Entry points

| Import                       | What it has                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@frontmcp/adapters`         | `OpenapiAdapter`, `OpenApiSpecPoller`, and the OpenAPI helpers and types.                                                                               |
| `@frontmcp/adapters/openapi` | The same OpenAPI exports, with `OpenapiAdapter` as the default export.                                                                                  |
| `@frontmcp/adapters/skills`  | Skill bundle sources and the bundle store used by [`@frontmcp/plugin-skilled-openapi`](https://www.npmjs.com/package/@frontmcp/plugin-skilled-openapi). |

The root and `/openapi` entry points are built separately, each with its own copy of `OpenapiAdapter`, so import it from one of them throughout an app.

## Docs

- [OpenAPI adapter](https://frontmcp.dev/reference/adapters/openapi): every option, credentials, transforms and spec polling
- [Wrapping an OpenAPI service](https://frontmcp.dev/learn/wrapping-an-openapi-service): a step-by-step guide
- [Pet Store from OpenAPI](https://frontmcp.dev/examples/pet-store-from-openapi): a whole API wrapped and made fit for a model
- [`@Adapter`](https://frontmcp.dev/reference/sdk/adapter): writing an adapter of your own

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the framework the adapter plugs into.
- [`@frontmcp/plugin-skilled-openapi`](https://www.npmjs.com/package/@frontmcp/plugin-skilled-openapi): for an API too large to list as tools.
- [`@frontmcp/testing`](https://www.npmjs.com/package/@frontmcp/testing): end-to-end tests for the tools an adapter generates.
- [`mcp-from-openapi`](https://www.npmjs.com/package/mcp-from-openapi): the OpenAPI-to-MCP converter underneath.

## Contributing

Source: [`libs/adapters`](https://github.com/agentfront/frontmcp/tree/main/libs/adapters). Issues and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
