---
name: file-layout
description: Flat sibling vs folder-per-tool layouts. <name>.schema.ts / <name>.tool.ts / <name>.tool.spec.ts.
---

# File layout for tools

Two endorsed layouts. Pick based on tool count per app and whether each tool has local helpers / fixtures / error types.

## Flat siblings (≤3 tools per app, or each tool fits in one screen)

```
src/apps/main/tools/
├── get-weather.tool.ts        # @Tool class, execute()
├── get-weather.schema.ts      # input/output schemas + derived types
├── get-weather.tool.spec.ts   # unit tests
├── greet-user.tool.ts
├── greet-user.schema.ts
└── greet-user.tool.spec.ts
```

## Folder-per-tool (>3 tools per app, or tool has helpers / fixtures / errors)

```
src/apps/main/tools/
├── get-weather/
│   ├── get-weather.tool.ts        # @Tool class, execute()
│   ├── get-weather.schema.ts      # input/output schemas + derived types
│   ├── get-weather.tool.spec.ts   # unit tests
│   ├── get-weather.errors.ts      # GetWeatherUnavailableError etc.
│   ├── get-weather.fixtures.ts    # test fixtures, shared with the spec
│   ├── helpers.ts                 # tool-local utility functions
│   ├── index.ts                   # barrel re-export
│   └── get-weather.widget.tsx     # optional UI widget (if ui: { file: … })
└── greet-user/
    └── …
```

`index.ts` for the folder layout:

```typescript
// src/apps/main/tools/get-weather/index.ts
export { GetWeatherTool } from './get-weather.tool';
export {
  inputSchema as getWeatherInputSchema,
  outputSchema as getWeatherOutputSchema,
  type GetWeatherInput,
  type GetWeatherOutput,
} from './get-weather.schema';
```

## File-name conventions

| File                  | Purpose                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `<name>.tool.ts`      | The `@Tool`-decorated class (or `tool({...})(handler)` value)                                |
| `<name>.schema.ts`    | `inputSchema`, `outputSchema`, and the derived `Input` / `Output` types                      |
| `<name>.tool.spec.ts` | Unit test (jest). NOT `.test.ts` — see [CLAUDE.md test-file-naming rule](../../../CLAUDE.md) |
| `<name>.widget.tsx`   | Optional UI widget — `.widget.tsx` is excluded from server typecheck (#445 fix)              |
| `<name>.errors.ts`    | Optional — custom `PublicMcpError` subclasses for this tool                                  |
| `<name>.fixtures.ts`  | Optional — test fixtures the spec imports                                                    |

## Why split schema and tool?

```typescript
// ✅ Schema in its own file — re-importable by:
// - the tool itself
// - the .tool.spec.ts file
// - sibling tools (e.g. the create-X tool may share a schema field with the update-X tool)
// - generated clients
// - elicitation flows that reuse the same Zod field

// src/apps/main/tools/get-weather.schema.ts
export const inputSchema = { city: z.string() };
export const outputSchema = { temperatureF: z.number() };
export type GetWeatherInput = ToolInputOf<{ inputSchema: typeof inputSchema }>;
export type GetWeatherOutput = ToolOutputOf<{ outputSchema: typeof outputSchema }>;
```

If you hoisted the entire `@Tool({...})` config, consumers would drag the `@Tool` decorator transitively. Schemas alone are inert.

## Naming

- File names: `kebab-case` — `get-weather.tool.ts`.
- Class names: `PascalCase` — `GetWeatherTool`. The `Tool` suffix is conventional, not required.
- Tool `name:` field: `snake_case` — `get_weather`. MCP protocol convention. ([rule](../rules/snake-case-tool-names.md))

## Widget files

`.tsx` / `.jsx` widget files use the `*.widget.tsx` naming convention. The scaffolded `tsconfig.json` excludes `**/*.widget.tsx` from the server typecheck (#445 fix) — widgets are bundled separately by `@frontmcp/uipack` (esbuild) at render time, with React loaded externally. If you want IDE typecheck for widget sources, add a sibling `tsconfig.widget.json` with `jsx: 'react-jsx'` and `include: ['src/**/*.widget.tsx']`.

## See also

- [`derived-types.md`](./derived-types.md) — why schemas hoist
- [`testing.md`](./testing.md) — `.tool.spec.ts` patterns
- [`ui-widgets.md`](./ui-widgets.md) — widget file conventions
