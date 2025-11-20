import { z } from "zod";

/**
 * Shared output wrapper: all HTTP tools must return { status, headers, body }.
 */

export const HttpStatusSchema = z.number().int().min(100).max(599);
export const HttpHeadersSchema = z.record(z.string());

export const makeHttpOutputSchema = <TBody extends z.ZodTypeAny>(bodySchema: TBody) =>
  z.object({
    status: HttpStatusSchema,
    headers: HttpHeadersSchema.optional(),
    body: bodySchema
  });

export type HttpOutput<TBody> = {
  status: number;
  headers?: Record<string, string>;
  body: TBody;
};

/**
 * Shared auth/context types for TS tools.
 */

export const AuthContextSchema = z.object({
  oauth2: z
    .object({
      accessToken: z.string(),
      idToken: z.string().optional(),
      claims: z.record(z.any()).optional()
    })
    .optional(),
  bearer: z
    .object({
      token: z.string()
    })
    .optional(),
  apiKey: z
    .object({
      name: z.string().optional(),
      value: z.string()
    })
    .optional()
});

export type AuthContext = z.infer<typeof AuthContextSchema>;

export const ExecuteContextSchema = z.object({
  baseUrl: z.string().url(),
  auth: AuthContextSchema,
  fetch: z
    .function()
    .args(z.string(), z.any())
    .returns(z.promise(z.any()))
    .optional(),
  requestId: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  logDebug: z.boolean().optional()
});

export type ExecuteContext = z.infer<typeof ExecuteContextSchema>;

/**
 * Generic execute signature for TS tools.
 */

export type ToolExecute<I, B> = (args: {
  input: I;
  ctx: ExecuteContext;
}) => Promise<HttpOutput<B>>;
