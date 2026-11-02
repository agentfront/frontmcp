import { z } from '@frontmcp/lazy-zod';

/** The version of the `frontmcp.manifest.json` format. It changes when a field changes meaning or is removed. */
export const SERVER_MANIFEST_VERSION = 1;

/** The file `frontmcp build` writes into each target's output directory. */
export const SERVER_MANIFEST_FILE = 'frontmcp.manifest.json';

const jsonObjectSchema = z.record(z.string(), z.unknown());

const ownedEntryShape = {
  /** The id of the app that owns the entry; absent for the server's own entries and the framework's. */
  app: z.string().optional(),
  /** The entry's owner lineage, root first, such as `app:billing/plugin:cache`. */
  owner: z.string(),
  /** `false` when the entry is off, `'source'` when an `EnabledSource` decides at run time; absent when it is on. */
  enabled: z.union([z.literal(false), z.literal('source')]).optional(),
  /** The entry's `availableWhen`, which the server applies at run time. */
  availableWhen: jsonObjectSchema.optional(),
  /** `true` when the entry declares `authorities`, which filter listings per caller. */
  authorities: z.literal(true).optional(),
};

export const manifestToolSchema = z.object({
  name: z.string(),
  ...ownedEntryShape,
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: jsonObjectSchema,
  outputSchema: jsonObjectSchema.optional(),
  annotations: jsonObjectSchema.optional(),
  icons: z.array(jsonObjectSchema).optional(),
  _meta: jsonObjectSchema.optional(),
  tags: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),
  visibility: z.enum(['public', 'hidden', 'internal']),
  execution: jsonObjectSchema.optional(),
  output: jsonObjectSchema.optional(),
  examples: z.array(jsonObjectSchema).optional(),
  /** `true` when the tool has a widget: `tools/list` adds its `_meta.ui` keys for each client. */
  ui: z.literal(true).optional(),
});

const resourceShape = {
  name: z.string(),
  ...ownedEntryShape,
  title: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  icons: z.array(jsonObjectSchema).optional(),
  annotations: jsonObjectSchema.optional(),
  _meta: jsonObjectSchema.optional(),
};

export const manifestResourceSchema = z.object({ uri: z.string(), ...resourceShape });

export const manifestResourceTemplateSchema = z.object({ uriTemplate: z.string(), ...resourceShape });

export const manifestPromptSchema = z.object({
  name: z.string(),
  ...ownedEntryShape,
  title: z.string().optional(),
  description: z.string().optional(),
  arguments: z
    .array(z.object({ name: z.string(), description: z.string().optional(), required: z.boolean().optional() }))
    .optional(),
  icons: z.array(jsonObjectSchema).optional(),
});

export const manifestSkillSchema = z.object({
  name: z.string(),
  ...ownedEntryShape,
  /** The skill's `skill://` path: its `skillPath` joined with `/`, or its name. */
  path: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional(),
  visibility: z.enum(['mcp', 'http', 'both']),
  hidden: z.literal(true).optional(),
  tools: z.array(z.object({ name: z.string(), purpose: z.string().optional(), required: z.boolean().optional() })),
  license: z.string().optional(),
  /** `computeSkillHash` of the skill's loaded content; absent when its instructions could not be loaded. */
  hash: z.string().optional(),
});

export const manifestAppSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  remote: z.literal(true).optional(),
  standalone: z.union([z.boolean(), z.literal('includeInParent')]).optional(),
  output: jsonObjectSchema.optional(),
});

export const serverManifestSchema = z.object({
  manifestVersion: z.literal(SERVER_MANIFEST_VERSION),
  server: z.object({
    name: z.string(),
    version: z.string(),
    title: z.string().optional(),
    /** The `initialize` instructions a client with no credentials gets. */
    instructions: z.string().optional(),
  }),
  /** The `instructionsBudget` limits, in characters; absent when the budget is off. */
  budget: z.object({ instructions: z.number(), toolDescription: z.number() }).optional(),
  apps: z.array(manifestAppSchema),
  tools: z.array(manifestToolSchema),
  resources: z.array(manifestResourceSchema),
  resourceTemplates: z.array(manifestResourceTemplateSchema),
  prompts: z.array(manifestPromptSchema),
  skills: z.array(manifestSkillSchema),
});

export type ServerManifest = z.infer<typeof serverManifestSchema>;
export type ManifestTool = z.infer<typeof manifestToolSchema>;
export type ManifestResource = z.infer<typeof manifestResourceSchema>;
export type ManifestResourceTemplate = z.infer<typeof manifestResourceTemplateSchema>;
export type ManifestPrompt = z.infer<typeof manifestPromptSchema>;
export type ManifestSkill = z.infer<typeof manifestSkillSchema>;
export type ManifestApp = z.infer<typeof manifestAppSchema>;
