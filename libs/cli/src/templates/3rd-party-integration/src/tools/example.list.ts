import { z } from "zod";
import {
  ExecuteContextSchema,
  HttpOutput,
  ToolExecute,
  makeHttpOutputSchema
} from "../mcp-http-types";
import { HttpClient } from "../http-client";

// MCP-visible input schema.
// Keep this in sync with tools/json/example.list.json -> input_schema.
export const inputSchema = z
  .object({
    limit: z.number().int().min(1).max(1000).optional(),
    query: z.string().optional()
  })
  .strict();

export type Input = z.infer<typeof inputSchema>;

// Body payload for success
export const ItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string()
  })
  .strict();

export const BodySchema = z
  .object({
    items: z.array(ItemSchema),
    nextCursor: z.string().nullable()
  })
  .strict();

export type Body = z.infer<typeof BodySchema>;

// HTTP wrapper output
export const outputSchema = makeHttpOutputSchema(BodySchema);
export type Output = HttpOutput<Body>;

// Optional: error body type if you want to distinguish
const ErrorBodySchema = z
  .object({
    error: z.object({
      code: z.string().optional(),
      message: z.string()
    })
  })
  .strip();

/**
 * Example tool: "example.list"
 *
 * - Replace path/method/logic with actual __OWNER__/__SERVICE__ API calls.
 * - Demonstrates:
 *   - strict input validation
 *   - HTTP client with auth
 *   - typed body mapping
 *   - non-2xx error normalization
 */
export const execute: ToolExecute<Input, Body> = async ({ input, ctx }) => {
  const ctxSafe = ExecuteContextSchema.parse(ctx);
  const http = new HttpClient(ctxSafe);

  // Construct path; you can also use claims from ctxSafe.auth.oauth2?.claims here.
  const path = "/tenants/self/resources";

  const res = await http.request({
    method: "GET",
    path,
    query: {
      limit: input.limit ?? 50,
      query: input.query
    }
  });

  // Treat non-2xx as an error: normalize upstream error details and throw.
  if (res.status < 200 || res.status >= 300) {
    const errorBody = ErrorBodySchema.safeParse(
      res.json ?? { error: { message: res.text ?? "Unknown error" } }
    );
    throw new Error(
      `Upstream error (${res.status}): ${
        errorBody.success ? errorBody.data.error.message : "Unknown error"
      }`
    );
  }

  const body: Body = BodySchema.parse({
    items: Array.isArray(res.json?.items)
      ? res.json.items.map((it: any) => ({
        id: String(it.id),
        name: String(it.name),
        type: String(it.type ?? "unknown")
      }))
      : [],
    nextCursor: res.json?.nextCursor ?? null
  });

  return outputSchema.parse({
    status: res.status,
    headers: res.headers,
    body
  });
};
