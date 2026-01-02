import { z } from 'zod';

/**
 * CDN configuration for loading dashboard UI from external sources.
 */
export const cdnConfigSchema = z.object({
  /** Base URL for the dashboard UI bundle (e.g., https://esm.sh/@frontmcp/dashboard-ui@1.0.0) */
  entrypoint: z.string().optional(),
  /** React CDN URL */
  react: z.string().default('https://esm.sh/react@19'),
  /** React DOM CDN URL */
  reactDom: z.string().default('https://esm.sh/react-dom@19'),
  /** React DOM client CDN URL */
  reactDomClient: z.string().default('https://esm.sh/react-dom@19/client'),
  /** React JSX runtime CDN URL */
  reactJsxRuntime: z.string().default('https://esm.sh/react@19/jsx-runtime'),
  /** React Router CDN URL */
  reactRouter: z.string().default('https://esm.sh/react-router-dom@7'),
  /** XYFlow (React Flow) CDN URL */
  xyflow: z.string().default('https://esm.sh/@xyflow/react@12?external=react,react-dom'),
  /** Dagre layout library CDN URL */
  dagre: z.string().default('https://esm.sh/dagre@0.8.5'),
  /** XYFlow CSS URL */
  xyflowCss: z.string().default('https://esm.sh/@xyflow/react@12/dist/style.css'),
});

/** CDN config type */
export type CdnConfig = z.output<typeof cdnConfigSchema>;

/**
 * Authentication configuration for dashboard access.
 */
export const dashboardAuthSchema = z.object({
  /** Enable authentication (default: false) */
  enabled: z.boolean().default(false),
  /** Secret token for query param authentication (?token=xxx) */
  token: z.string().optional(),
});

/** Dashboard auth type */
export type DashboardAuth = z.output<typeof dashboardAuthSchema>;

/**
 * Dashboard plugin options schema.
 */
export const dashboardPluginOptionsSchema = z.object({
  /** Enable/disable dashboard (undefined = auto: enabled in dev, disabled in prod) */
  enabled: z.boolean().optional(),
  /** Base path for dashboard routes (default: /dashboard) */
  basePath: z.string().default('/dashboard'),
  /** Authentication configuration */
  auth: dashboardAuthSchema.optional().transform((v) => dashboardAuthSchema.parse(v ?? {})),
  /** CDN configuration for UI loading */
  cdn: cdnConfigSchema.optional().transform((v) => cdnConfigSchema.parse(v ?? {})),
});

/** Dashboard plugin options (parsed/validated) */
export type DashboardPluginOptions = z.output<typeof dashboardPluginOptionsSchema>;

/** Dashboard plugin options input (before validation) */
export type DashboardPluginOptionsInput = z.input<typeof dashboardPluginOptionsSchema>;

/** Default dashboard plugin options */
export const defaultDashboardPluginOptions: DashboardPluginOptionsInput = {
  basePath: '/dashboard',
  auth: { enabled: false },
  cdn: {},
};

/**
 * Check if dashboard is enabled based on options and environment.
 */
export function isDashboardEnabled(options: DashboardPluginOptions): boolean {
  if (options.enabled !== undefined) {
    return options.enabled;
  }
  // Auto-detect: enabled in development, disabled in production
  return process.env['NODE_ENV'] !== 'production';
}
