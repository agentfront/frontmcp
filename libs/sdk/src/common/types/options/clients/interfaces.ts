// common/types/options/clients/interfaces.ts

/**
 * How a `tools/call` answer carries its data to a client.
 *
 * - `'both'` (default): the JSON in the text content and the same value in `structuredContent`.
 * - `'only'`: `structuredContent`, with a one-line summary as the text. Applies to tools whose
 *   `outputSchema` `tools/list` lists; other tools answer as with `'both'`.
 * - `'text'`: the text content only. `tools/list` leaves `outputSchema` out for that client.
 */
export type StructuredAnswerMode = 'both' | 'only' | 'text';

/**
 * Resource annotations a client receives in `resources/list` and `resources/templates/list`.
 *
 * - `'full'`: every annotation, including `priority: 0.8` on each skill's `SKILL.md`
 *   (as `skillsConfig.resourceAnnotations: 'full'`).
 * - `'no-numbers'`: no numeric annotation (`priority`), on any resource.
 */
export type ClientAnnotationsMode = 'full' | 'no-numbers';

/**
 * The skills part of the `initialize` instructions a client receives.
 *
 * - `'full'`: the skill catalog, as `skillsConfig.injectInstructions: 'append'`.
 * - `'compact'`: one line with the number of skills, as `skillsConfig.injectInstructions: 'compact'`.
 */
export type ClientInstructionsMode = 'full' | 'compact';

/** What FrontMCP sends a client whose `clientInfo.name` matches the profile's key. */
export interface ClientProfile {
  /** @default 'both' */
  structured?: StructuredAnswerMode;
  /** Unset: as `skillsConfig.resourceAnnotations` says. */
  annotations?: ClientAnnotationsMode;
  /** Unset: as `skillsConfig.injectInstructions` says. */
  instructions?: ClientInstructionsMode;
}

/**
 * Client profiles keyed by a glob of the `clientInfo.name` a client sends at `initialize`
 * (`*` any characters, `?` one, matched without regard to case). The first key that matches wins.
 *
 * @example
 * ```typescript
 * clients: {
 *   'codex-mcp-client': { structured: 'text' },
 *   'claude-code': { structured: 'only', instructions: 'compact' },
 * }
 * ```
 */
export type ClientProfilesOptionsInterface = Record<string, ClientProfile>;
