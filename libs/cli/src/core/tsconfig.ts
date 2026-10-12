import * as path from 'path';

import { fileExists, readFile, readJSON, writeFile, writeJSON } from '@frontmcp/utils';

import { JsoncDuplicateKeyError, JsoncParseError, parseJsoncObject, updateJsoncText } from '../shared/jsonc';
import { c } from './colors';

export const REQUIRED_DECORATOR_FIELDS = {
  target: 'es2021',
  module: 'esnext',
  emitDecoratorMetadata: true,
  experimentalDecorators: true,
  strictFunctionTypes: true,
  moduleResolution: 'bundler',
} as const;

/** `frontmcp build` compiles with `--module commonjs`: TypeScript 5 needs `node` for it, 6+ accepts `bundler`. */
export type ModuleResolution = 'bundler' | 'node';

const LEGACY_MODULE_RESOLUTIONS = ['node', 'node10', 'classic'];

const TYPES_ENTRIES = [
  { entry: 'node', packageName: '@types/node' },
  { entry: 'jest', packageName: '@types/jest' },
  { entry: '@frontmcp/testing', packageName: '@frontmcp/testing' },
] as const;

/**
 * Filename suffixes for tool UI widget source files that ship to the browser.
 * These are bundled separately by `@frontmcp/uipack` (esbuild) at render time,
 * not by the server-side `tsc --noEmit` pass. We exclude them from the server
 * typecheck so widget-only TS settings (`jsx`, React types) aren't required at
 * the project level (issue #445).
 */
export const WIDGET_FILE_PATTERNS = ['**/*.widget.tsx', '**/*.widget.jsx'] as const;

export const RECOMMENDED_TSCONFIG = {
  compilerOptions: {
    target: REQUIRED_DECORATOR_FIELDS.target,
    module: REQUIRED_DECORATOR_FIELDS.module,
    emitDecoratorMetadata: REQUIRED_DECORATOR_FIELDS.emitDecoratorMetadata,
    experimentalDecorators: REQUIRED_DECORATOR_FIELDS.experimentalDecorators,
    strictFunctionTypes: REQUIRED_DECORATOR_FIELDS.strictFunctionTypes,
    moduleResolution: REQUIRED_DECORATOR_FIELDS.moduleResolution,
    strict: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    sourceMap: true,
    outDir: 'dist',
    rootDir: 'src',
  },
  include: ['src/**/*'],
  exclude: [...WIDGET_FILE_PATTERNS],
} as const;

export function deepMerge<T extends Record<string, any>, U extends Record<string, any>>(base: T, patch: U): T & U {
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(base[k] ?? {}, v as Record<string, any>);
    } else {
      out[k] = v;
    }
  }
  return out as T & U;
}

export function ensureRequiredTsOptions(
  obj: Record<string, any>,
  moduleResolution: ModuleResolution = REQUIRED_DECORATOR_FIELDS.moduleResolution,
): Record<string, any> {
  const next = { ...obj };
  next.compilerOptions = { ...(next.compilerOptions || {}) };
  next.compilerOptions.target = REQUIRED_DECORATOR_FIELDS.target;
  next.compilerOptions.module = REQUIRED_DECORATOR_FIELDS.module;
  next.compilerOptions.emitDecoratorMetadata = REQUIRED_DECORATOR_FIELDS.emitDecoratorMetadata;
  next.compilerOptions.experimentalDecorators = REQUIRED_DECORATOR_FIELDS.experimentalDecorators;
  if (moduleResolutionIssue(next.compilerOptions.moduleResolution, moduleResolution)) {
    next.compilerOptions.moduleResolution = moduleResolution;
  }
  return next;
}

/**
 * Ensure `tsconfig.exclude` contains the widget-file glob patterns so server
 * typecheck skips browser-side `.widget.tsx` / `.widget.jsx` files (issue #445).
 *
 * Preserves any existing exclude entries. Returns a new object — does not
 * mutate `obj`.
 */
export function ensureWidgetExcludes(obj: Record<string, unknown>): {
  result: Record<string, unknown>;
  added: string[];
} {
  const next: Record<string, unknown> = { ...obj };
  const rawExclude = next['exclude'];
  const existing: unknown[] = Array.isArray(rawExclude) ? rawExclude : [];
  const seen = new Set(existing.filter((v): v is string => typeof v === 'string'));
  const added: string[] = [];
  for (const pattern of WIDGET_FILE_PATTERNS) {
    if (!seen.has(pattern)) {
      seen.add(pattern);
      added.push(pattern);
    }
  }
  next['exclude'] = [...existing.filter((v): v is string => typeof v === 'string'), ...added];
  return { result: next, added };
}

function normalizeStr(x: unknown): string | undefined {
  return typeof x === 'string' ? x.toLowerCase() : undefined;
}

function moduleResolutionIssue(value: unknown, recommended: ModuleResolution): string | undefined {
  const resolution = normalizeStr(value);
  if (resolution === 'node16' || resolution === 'nodenext') {
    return `compilerOptions.moduleResolution "${value}" requires module "${value}" (TS5110) — use "${recommended}"`;
  }
  if (recommended === 'bundler' && resolution !== undefined && LEGACY_MODULE_RESOLUTIONS.includes(resolution)) {
    return `compilerOptions.moduleResolution "${value}" is deprecated in TypeScript 6 and removed in 7 — use "${recommended}"`;
  }
  return undefined;
}

export function checkRequiredTsOptions(
  compilerOptions: Record<string, any> | undefined,
  moduleResolution: ModuleResolution = REQUIRED_DECORATOR_FIELDS.moduleResolution,
) {
  const issues: string[] = [];
  const ok: string[] = [];

  const target = normalizeStr(compilerOptions?.target);
  const moduleVal = normalizeStr(compilerOptions?.module);
  const edm = compilerOptions?.emitDecoratorMetadata;
  const ed = compilerOptions?.experimentalDecorators;

  if (target === REQUIRED_DECORATOR_FIELDS.target)
    ok.push(`compilerOptions.target = "${REQUIRED_DECORATOR_FIELDS.target}"`);
  else issues.push(`compilerOptions.target should be "${REQUIRED_DECORATOR_FIELDS.target}"`);

  if (moduleVal === REQUIRED_DECORATOR_FIELDS.module)
    ok.push(`compilerOptions.module = "${REQUIRED_DECORATOR_FIELDS.module}"`);
  else issues.push(`compilerOptions.module should be "${REQUIRED_DECORATOR_FIELDS.module}"`);

  if (edm === REQUIRED_DECORATOR_FIELDS.emitDecoratorMetadata) ok.push(`compilerOptions.emitDecoratorMetadata = true`);
  else issues.push(`compilerOptions.emitDecoratorMetadata should be true`);

  if (ed === REQUIRED_DECORATOR_FIELDS.experimentalDecorators) ok.push(`compilerOptions.experimentalDecorators = true`);
  else issues.push(`compilerOptions.experimentalDecorators should be true`);

  const resolutionIssue = moduleResolutionIssue(compilerOptions?.moduleResolution, moduleResolution);
  if (resolutionIssue) issues.push(resolutionIssue);

  return { ok, issues };
}

interface ProjectPackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function readProjectPackageJson(cwd: string): Promise<ProjectPackageJson> {
  return (await readJSON<ProjectPackageJson>(path.join(cwd, 'package.json'))) ?? {};
}

function resolveInstalledPackageJson(cwd: string, packageName: string): string | undefined {
  try {
    return require.resolve(`${packageName}/package.json`, { paths: [cwd] });
  } catch {
    return undefined;
  }
}

function declaredRange(packageJson: ProjectPackageJson, packageName: string): string | undefined {
  return packageJson.devDependencies?.[packageName] ?? packageJson.dependencies?.[packageName];
}

/** The project's TypeScript major: the installed compiler first, then the declared range. */
async function typescriptMajor(cwd: string, packageJson: ProjectPackageJson): Promise<number | undefined> {
  const installedPackageJson = resolveInstalledPackageJson(cwd, 'typescript');
  const version = installedPackageJson
    ? (await readJSON<{ version?: string }>(installedPackageJson))?.version
    : declaredRange(packageJson, 'typescript');
  const major = Number(version?.match(/\d+/)?.[0]);
  return Number.isFinite(major) ? major : undefined;
}

/** A project without its own TypeScript builds with the registry's latest, so it gets `bundler` too. */
export async function resolveModuleResolution(
  cwd: string,
  packageJson?: ProjectPackageJson,
): Promise<ModuleResolution> {
  const major = await typescriptMajor(cwd, packageJson ?? (await readProjectPackageJson(cwd)));
  return major !== undefined && major < 6 ? 'node' : REQUIRED_DECORATOR_FIELDS.moduleResolution;
}

async function recommendedTsconfigFor(cwd: string) {
  const packageJson = await readProjectPackageJson(cwd);
  const types = TYPES_ENTRIES.filter(
    ({ packageName }) =>
      declaredRange(packageJson, packageName) !== undefined ||
      resolveInstalledPackageJson(cwd, packageName) !== undefined,
  ).map(({ entry }) => entry);
  return {
    ...RECOMMENDED_TSCONFIG,
    compilerOptions: {
      ...RECOMMENDED_TSCONFIG.compilerOptions,
      moduleResolution: await resolveModuleResolution(cwd, packageJson),
      ...(types.length > 0 && { types }),
    },
  };
}

/**
 * Read a `tsconfig.json` the way TypeScript does — comments and trailing commas
 * allowed. Returns `undefined` when the file does not exist; throws
 * `JsoncParseError` when it exists but cannot be parsed.
 */
export async function readTsconfig(
  tsconfigPath: string,
): Promise<{ text: string; config: Record<string, any> } | undefined> {
  if (!(await fileExists(tsconfigPath))) return undefined;
  const text = await readFile(tsconfigPath);
  return { text, config: parseJsoncObject(text, path.basename(tsconfigPath)) };
}

/** A tsconfig.json `init` cannot read or edit safely is left as it is; say so. */
function leftUnchanged(err: unknown): unknown {
  if (!(err instanceof JsoncParseError) && !(err instanceof JsoncDuplicateKeyError)) return err;
  return new Error(`${err.message}. It was left unchanged — fix it, then run "frontmcp init" again.`, { cause: err });
}

export async function runInit(baseDir?: string): Promise<void> {
  const cwd = baseDir ?? process.cwd();
  const tsconfigPath = path.join(cwd, 'tsconfig.json');
  // #679 — a parse failure must never read as "not found": that path wrote the
  // default config over the user's file. The file is left untouched instead.
  let current: Awaited<ReturnType<typeof readTsconfig>>;
  try {
    current = await readTsconfig(tsconfigPath);
  } catch (err) {
    throw leftUnchanged(err);
  }

  const recommended = await recommendedTsconfigFor(cwd);
  if (!current) {
    console.log(c('yellow', `tsconfig.json not found — creating one in ${path.relative(process.cwd(), cwd) || '.'}.`));
    await writeJSON(tsconfigPath, recommended);
    console.log(c('green', '✅ Created tsconfig.json with required decorator settings.'));
    return;
  }

  const existing = current.config;
  let merged = deepMerge(recommended as any, existing);
  merged = ensureRequiredTsOptions(merged, recommended.compilerOptions.moduleResolution);

  const { result: withWidgetExcludes, added: addedExcludes } = ensureWidgetExcludes(merged);
  merged = withWidgetExcludes;

  // Edit only the keys that change, so comments and formatting survive.
  let updated: string;
  try {
    updated = updateJsoncText(current.text, existing, merged, path.basename(tsconfigPath));
  } catch (err) {
    throw leftUnchanged(err);
  }
  if (updated === current.text) {
    console.log(c('green', '✅ tsconfig.json verified (required decorator settings already present).'));
    return;
  }
  await writeFile(tsconfigPath, updated);
  console.log(c('green', '✅ tsconfig.json verified and updated (required decorator settings enforced).'));
  if (addedExcludes.length > 0) {
    console.log(
      c(
        'gray',
        `  Added widget-file excludes to tsconfig.exclude (${addedExcludes.join(', ')}) — ` +
          `'.widget.tsx' / '.widget.jsx' files are bundled separately by uipack at render time ` +
          `and don't need to satisfy the server typecheck (issue #445).`,
      ),
    );
  }
}
