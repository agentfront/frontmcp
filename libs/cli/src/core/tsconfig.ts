import * as path from 'path';
import { c } from './colors';
import { fileExists, readJSON, writeJSON } from '@frontmcp/utils';

export const REQUIRED_DECORATOR_FIELDS = {
  target: 'es2021',
  module: 'esnext',
  emitDecoratorMetadata: true,
  experimentalDecorators: true,
  strictFunctionTypes: true,
  moduleResolution: 'node',
} as const;

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
    types: ['node', '@types/jest', '@frontmcp/testing'],
  },
  include: ['src/**/*'],
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

export function ensureRequiredTsOptions(obj: Record<string, any>): Record<string, any> {
  const next = { ...obj };
  next.compilerOptions = { ...(next.compilerOptions || {}) };
  next.compilerOptions.target = REQUIRED_DECORATOR_FIELDS.target;
  next.compilerOptions.module = REQUIRED_DECORATOR_FIELDS.module;
  next.compilerOptions.emitDecoratorMetadata = REQUIRED_DECORATOR_FIELDS.emitDecoratorMetadata;
  next.compilerOptions.experimentalDecorators = REQUIRED_DECORATOR_FIELDS.experimentalDecorators;
  return next;
}

function normalizeStr(x: unknown): string | undefined {
  return typeof x === 'string' ? x.toLowerCase() : undefined;
}

export function checkRequiredTsOptions(compilerOptions: Record<string, any> | undefined) {
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

  return { ok, issues };
}

export async function runInit(baseDir?: string): Promise<void> {
  const cwd = baseDir ?? process.cwd();
  const tsconfigPath = path.join(cwd, 'tsconfig.json');
  const existing = await readJSON<Record<string, any>>(tsconfigPath);

  if (!existing) {
    console.log(c('yellow', `tsconfig.json not found — creating one in ${path.relative(process.cwd(), cwd) || '.'}.`));
    await writeJSON(tsconfigPath, RECOMMENDED_TSCONFIG);
    console.log(c('green', '✅ Created tsconfig.json with required decorator settings.'));
    return;
  }

  let merged = deepMerge(RECOMMENDED_TSCONFIG as any, existing);
  merged = ensureRequiredTsOptions(merged);

  await writeJSON(tsconfigPath, merged);
  console.log(c('green', '✅ tsconfig.json verified and updated (required decorator settings enforced).'));
}
