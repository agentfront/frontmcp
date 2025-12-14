import { z } from 'zod';

/**
 * Zod schema for validating mcp-session-id header format.
 * Uses Zod's built-in validators to prevent ReDoS attacks and ensure safe validation.
 *
 * - Max length: 256 characters (session IDs are typically UUIDs or short tokens)
 * - Only allows printable ASCII characters (0x20-0x7E)
 * - Rejects control characters and null bytes
 */
export const mcpSessionHeaderSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (value) => {
      // Check each character is printable ASCII (0x20-0x7E)
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code < 0x20 || code > 0x7e) {
          return false;
        }
      }
      return true;
    },
    { message: 'Session ID must contain only printable ASCII characters' },
  )
  .refine((v) => v === v.trim(), {
    message: 'Session ID must not have leading/trailing whitespace',
  });

/**
 * Validate mcp-session-id header using Zod schema.
 * Returns undefined for invalid or missing values.
 */
export function validateMcpSessionHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const result = mcpSessionHeaderSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
